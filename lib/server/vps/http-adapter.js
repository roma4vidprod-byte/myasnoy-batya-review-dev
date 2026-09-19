import http from 'node:http';
import { Buffer } from 'node:buffer';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const SAFE_ERRORS = new Map([
  ['PATH_INVALID',400], ['QUERY_INVALID',400], ['REQUEST_BODY_TOO_LARGE',413],
  ['BODY_TIMEOUT',408], ['REQUEST_ABORTED',400], ['JSON_INVALID',400],
  ['JSON_OBJECT_REQUIRED',400], ['JSON_KEYS_INVALID',400], ['BODY_NOT_ALLOWED',400],
  ['UNSUPPORTED_MEDIA_TYPE',415], ['HANDLER_TIMEOUT',504], ['INTERNAL_ERROR',500]
]);

export function parseTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20\x7f]/.test(raw)) throw failure('PATH_INVALID');
  const pos = raw.indexOf('?');
  const encoded = pos === -1 ? raw : raw.slice(0,pos);
  let pathname;
  try { pathname = decodeURIComponent(encoded); } catch { throw failure('PATH_INVALID'); }
  if (/[\\%\x00-\x20\x7f]/.test(pathname) || pathname.includes('//') || pathname.split('/').some(x => x.startsWith('.'))) throw failure('PATH_INVALID');
  const query = Object.create(null);
  let count = 0;
  for (const [key,value] of new URLSearchParams(pos === -1 ? '' : raw.slice(pos+1))) {
    if (++count > 64 || key.length > 128 || value.length > 2048 || forbidden.has(key)) throw failure('QUERY_INVALID');
    if (Object.hasOwn(query,key)) query[key] = Array.isArray(query[key]) ? [...query[key],value] : [query[key],value];
    else query[key] = value;
  }
  return { pathname, query };
}

function validateJsonKeys(value, depth = 0) {
  if (depth > 32) throw failure('JSON_KEYS_INVALID');
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) throw failure('JSON_KEYS_INVALID');
      validateJsonKeys(value[key], depth + 1);
    }
  }
}

async function readBody(req, { maxBodyBytes, bodyTimeoutMs }) {
  const len = req.headers['content-length'];
  if (len !== undefined && (!/^\d+$/.test(len) || Number(len) > maxBodyBytes)) throw failure('REQUEST_BODY_TOO_LARGE',413);
  if (['GET','HEAD'].includes(req.method)) {
    if ((len && Number(len) !== 0) || req.headers['transfer-encoding']) throw failure('BODY_NOT_ALLOWED');
    return undefined;
  }
  const media = req.headers['content-type'] || '';
  if (media && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media)) throw failure('UNSUPPORTED_MEDIA_TYPE',415);
  const chunks = [];
  let bytes = 0, timer;
  const consume = async () => {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) throw failure('REQUEST_BODY_TOO_LARGE',413);
      chunks.push(chunk);
    }
    if (!bytes) return {};
    if (!media) throw failure('UNSUPPORTED_MEDIA_TYPE',415);
    let data;
    try { data = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(Buffer.concat(chunks))); }
    catch { throw failure('JSON_INVALID'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('JSON_OBJECT_REQUIRED');
    validateJsonKeys(data);
    return data;
  };
  try {
    return await Promise.race([consume(), new Promise((_,reject) => {
      timer = setTimeout(() => reject(failure('BODY_TIMEOUT',408)), bodyTimeoutMs);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

function safeErrorCode(error) {
  try {
    const descriptor = error && Object.getOwnPropertyDescriptor(error,'code');
    const code = descriptor && Object.hasOwn(descriptor,'value') ? descriptor.value : null;
    return SAFE_ERRORS.has(code) ? code : 'INTERNAL_ERROR';
  } catch { return 'INTERNAL_ERROR'; }
}

function responseMethods(req,res) {
  res.status = code => {
    if (!Number.isInteger(code) || code < 100 || code > 599) throw failure('INTERNAL_ERROR',500);
    res.statusCode = code; return res;
  };
  res.send = value => {
    if (res.writableEnded || res.destroyed) return res;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''),'utf8');
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type',Buffer.isBuffer(value) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Length',bytes.length);
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return res;
  };
  res.json = value => {
    if (res.writableEnded || res.destroyed) return res;
    const data = JSON.stringify(value);
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.send(data);
  };
  // No redirect helper: no current handler requires it, and no arbitrary URL forwarding.
}

// Adapter for the existing (req,res) handler contract. Supplied handlers remain responsible
// for their own auth, revision guards and storage. Handler timeout does NOT roll back I/O.
export function createAdapterServer({ config, routes, logger = () => {} }) {
  if (!config || config.host !== '127.0.0.1' || !(routes instanceof Map)) throw new Error('VPS_ADAPTER_CONFIG_INVALID');
  for (const [path,route] of routes) {
    if (parseTarget(path).pathname !== path || !Array.isArray(route.methods) || !route.methods.length || typeof route.handler !== 'function') throw new Error('VPS_ROUTE_CONFIG_INVALID');
  }
  let stopping = false;
  const sockets = new Set();
  const server = http.createServer({maxHeaderSize:config.maxHeaderBytes}, async (req,res) => {
    const started = performance.now();
    let routeName = 'UNRESOLVED';
    const safeLog = () => {
      try { logger({event:'request_completed', route:routeName, method:['GET','HEAD','POST','PUT','DELETE','OPTIONS','PATCH'].includes(req.method) ? req.method : 'OTHER', status:res.statusCode, duration_ms:Math.round(performance.now()-started)}); } catch {}
    };
    res.once('finish',safeLog);
    responseMethods(req,res);
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
    const reply = (status,code) => {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      // No body, header or exception reflection.
      res.status(status).json({ok:false,error:code});
    };
    let timer;
    try {
      if (stopping) return reply(503,'SERVER_DRAINING');
      const address = server.address();
      const expectedHost = `127.0.0.1:${address?.port}`;
      if (req.rawHeaders.filter((v,i)=>i%2===0 && v.toLowerCase()==='host').length !== 1) return reply(400,'HOST_HEADER_INVALID');
      if (req.headers.host !== expectedHost) return reply(421,'HOST_NOT_ALLOWED');
      if (req.headers.expect) return reply(417,'EXPECT_NOT_SUPPORTED');
      const {pathname,query} = parseTarget(req.url);
      const route = routes.get(pathname);
      if (!route) return reply(404,'NOT_FOUND');
      routeName = pathname;
      if (!route.methods.includes(req.method)) {
        res.setHeader('Allow',route.methods.join(', '));
        return reply(405,'METHOD_NOT_ALLOWED');
      }
      req.query = query;
      req.body = await readBody(req,config);
      await Promise.race([
        Promise.resolve().then(() => route.handler(req,res)),
        new Promise((_,reject) => { timer=setTimeout(() => reject(failure('HANDLER_TIMEOUT',504)), config.handlerTimeoutMs); timer.unref(); })
      ]);
      if (!res.writableEnded && !res.destroyed) reply(500,'HANDLER_DID_NOT_RESPOND');
    } catch (error) {
      // Only our known errors carry allowed status; arbitrary handler errors are never exposed.
      const code = safeErrorCode(error);
      reply(SAFE_ERRORS.get(code),code);
    } finally { clearTimeout(timer); }
  });
  server.headersTimeout=config.headersTimeoutMs;
  server.requestTimeout=config.requestTimeoutMs;
  server.keepAliveTimeout=config.keepAliveTimeoutMs;
  server.maxHeadersCount=64;
  server.maxRequestsPerSocket=100;
  server.on('connection',socket => { sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); });
  server.on('clientError',(_,socket)=> { if(socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  server.on('checkContinue',(_,res)=> { res.writeHead(417,{'Connection':'close','Content-Length':'0'}); res.end(); });
  server.on('upgrade',(_,socket)=>socket.destroy());
  const stop = async () => {
    if(stopping) return;
    stopping=true;
    let drain;
    try {
      await new Promise(resolve => {
        drain=setTimeout(()=>{ for(const socket of sockets) socket.destroy(); resolve(); },config.shutdownTimeoutMs);
        drain.unref();
        server.close(()=>resolve());
        server.closeIdleConnections();
      });
    } finally { clearTimeout(drain); }
  };
  return {server,stop};
}
