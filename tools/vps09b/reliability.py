"""One bounded, no-HTTP reliability series. No DB, session, auth or application call.
Run only as the existing reader, with a cleared environment. No automatic rerun.
libcurl CONNECT_ONLY=1 performs TLS setup without an HTTP transfer.
"""
import ctypes as c
import ctypes.util
import datetime,ipaddress,json,os,re,subprocess,sys,time
from pathlib import Path
HOST='yandex.ru';NODE='/opt/node/bin/node';CADENCE=10.5;BUDGET=600
HERE=Path(__file__).resolve().parent
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(kind,data):print(json.dumps({'kind':kind,'utc':utc(),**data}),flush=True)
def node(request):
    try:
        p=subprocess.run([NODE,str(HERE/'node-probe.mjs')],input=json.dumps(request),capture_output=True,text=True,timeout=12)
        return json.loads(p.stdout)
    except Exception:return {'result':'FAIL','error':'DIAGNOSTIC_CHILD_UNAVAILABLE'}
def valid_ip(ip):
    if ipaddress.ip_address(ip).version!=4:raise ValueError('IPV4_REQUIRED')
    return ip
def plan(ips):
    if not 1<=len(ips)<=3:raise ValueError('BUDGET_COVERAGE_UNAVAILABLE')
    jobs=[]
    for round in range(10):
        jobs.extend({'client':'node','mode':'tcp','ip':valid_ip(ip),'round':round+1} for ip in ips)
        if round in (1,3,5,6,8,9):
            client=['node','curl','openssl','node','curl','openssl'][(1,3,5,6,8,9).index(round)]
            jobs.extend({'client':client,'mode':'tls','ip':ip,'round':1 if round<6 else 2} for ip in ips)
        if round in (2,5,8):
            jobs.extend({'client':'node','mode':'family','family':family,'round':(2,5,8).index(round)+1} for family in (0,4))
    return jobs
def resources():
    import resource
    def read(path):
        try:return Path(path).read_text().strip()
        except OSError:return None
    states={}
    for path in ['/proc/net/tcp','/proc/net/tcp6']:
        for line in (read(path) or '').splitlines()[1:]:
            parts=line.split()
            if len(parts)>3:states[parts[3]]=states.get(parts[3],0)+1
    mem={k:int(v) for k,v in re.findall(r'^(MemTotal|MemAvailable):\s+(\d+)',read('/proc/meminfo') or '',re.M)}
    return {'fd_limit':list(resource.getrlimit(resource.RLIMIT_NOFILE)),'file_nr':read('/proc/sys/fs/file-nr'),
      'ephemeral_ports':read('/proc/sys/net/ipv4/ip_local_port_range'),'tcp_count':sum(states.values()),
      'time_wait':states.get('06',0),'syn_sent':states.get('02',0),'load':list(os.getloadavg()),'memory_kib':mem,
      'conntrack_count':read('/proc/sys/net/netfilter/nf_conntrack_count'),'conntrack_max':read('/proc/sys/net/netfilter/nf_conntrack_max')}
def curl_probe(ip):
    valid_ip(ip);lib=c.CDLL(ctypes.util.find_library('curl'))
    lib.curl_easy_init.restype=c.c_void_p
    lib.curl_easy_setopt.argtypes=[c.c_void_p,c.c_int];lib.curl_easy_setopt.restype=c.c_int
    lib.curl_easy_getinfo.argtypes=[c.c_void_p,c.c_int];lib.curl_easy_getinfo.restype=c.c_int
    lib.curl_easy_perform.argtypes=[c.c_void_p];lib.curl_easy_perform.restype=c.c_int
    lib.curl_easy_cleanup.argtypes=[c.c_void_p]
    lib.curl_slist_append.argtypes=[c.c_void_p,c.c_char_p];lib.curl_slist_append.restype=c.c_void_p
    lib.curl_slist_free_all.argtypes=[c.c_void_p]
    h=lib.curl_easy_init();lst=None;proto=None;header_bytes=0
    if not h:raise RuntimeError('CURL_INIT_FAILED')
    @c.CFUNCTYPE(c.c_int,c.c_void_p,c.c_int,c.c_void_p,c.c_size_t,c.c_void_p)
    def debug(handle,typ,data,size,user):
        nonlocal proto,header_bytes
        if typ in (1,2,3,4):header_bytes+=size
        if typ==0:
            match=re.search(rb'SSL connection using (TLSv1\.[23])',c.string_at(data,min(size,2048)))
            if match:proto=match.group(1).decode('ascii')
        return 0
    def opt(k,v):
        if lib.curl_easy_setopt(h,k,v)!=0:raise RuntimeError('CURL_OPTION_FAILED')
    def info(k,typ):
        v=typ()
        if lib.curl_easy_getinfo(h,k,c.byref(v))!=0:raise RuntimeError('CURL_INFO_FAILED')
        return v.value
    start=time.monotonic()
    try:
        # CONNECT_ONLY=1, TLS peer+host verification, IPv4, no redirects, 10s cap.
        for k,v in [(141,1),(64,1),(81,2),(113,1),(52,0),(156,10000),(155,10000),(99,1),(41,1)]:opt(k,c.c_long(v))
        opt(10002,c.c_char_p(('https://'+HOST+'/').encode()));opt(10004,c.c_char_p(b''))
        lst=lib.curl_slist_append(None,f'{HOST}:443:{ip}'.encode());opt(10203,c.c_void_p(lst));opt(20094,debug)
        code=lib.curl_easy_perform(h)
        tcp=info(0x300005,c.c_double);tls=info(0x300021,c.c_double);errno=info(0x200019,c.c_long)
        response=info(0x200002,c.c_long);request=info(0x20000c,c.c_long)
        return {'result':'PASS' if code==0 and header_bytes==0 and response==0 and request==0 else 'FAIL',
          'curl_code':code,'os_errno':errno,'tcp_connected':tcp>0,'tcp_ms':round(tcp*1000,3) if tcp else None,
          'elapsed_ms':round((time.monotonic()-start)*1000),'tls_ms':round(tls*1000,3) if tls else None,
          'tls_version':proto,'certificate_valid':code==0,'timeout_phase':('TLS_HANDSHAKE' if tcp else 'TCP_CONNECT') if code==28 else None,
          'http_status':response,'http_request_bytes':request,'application_data_bytes':header_bytes,'http_requests':0}
    finally:
        lib.curl_easy_cleanup(h)
        if lst:lib.curl_slist_free_all(lst)
def openssl_projection(output,returncode,timed_out,elapsed):
    connected='SSL_connect:before SSL initialization' in output or 'CONNECTION ESTABLISHED' in output
    verified='Verification: OK' in output
    protocol=re.search(r'Protocol version: (TLSv1\.[23])',output)
    errno=re.search(r'connect:errno=(\d{1,3})',output)
    ok=returncode==0 and verified and protocol is not None
    return {'result':'PASS' if ok else 'FAIL','tcp_connected':connected,'tcp_ms':None,'elapsed_ms':elapsed,
      'tls_version':protocol.group(1) if protocol else None,'certificate_valid':verified,
      'exit_code':returncode,'os_errno':int(errno.group(1)) if errno else None,
      'timeout_phase':('TLS_HANDSHAKE' if connected else 'TCP_CONNECT') if timed_out else None,'http_requests':0}
def openssl_probe(ip):
    valid_ip(ip);start=time.monotonic();timed=False
    a=['openssl','s_client','-connect',ip+':443','-servername',HOST,'-verify_hostname',HOST,'-verify_return_error','-brief','-state','-no_ign_eof']
    try:
        p=subprocess.run(a,stdin=subprocess.DEVNULL,capture_output=True,timeout=10);out=p.stdout+p.stderr;code=p.returncode
    except subprocess.TimeoutExpired as e:out=(e.stdout or b'')+(e.stderr or b'');code=None;timed=True
    return openssl_projection(out.decode('utf8','replace'),code,timed,round((time.monotonic()-start)*1000))
def main():
    import pwd
    if len(sys.argv)!=1 or sys.platform!='linux' or pwd.getpwuid(os.getuid()).pw_name!='review-yandex-reader':raise RuntimeError('CONTEXT_DENIED')
    start=time.monotonic();initial=node({'mode':'dns'});emit('dns',initial)
    if initial.get('result')!='PASS':return 1
    ips=sorted({x['address'] for x in initial['addresses'] if x['family']==4});jobs=plan(ips)
    emit('start',{'hostname':HOST,'ipv4':ips,'planned':len(jobs),'cadence_seconds':CADENCE,'budget_seconds':BUDGET,'resources':resources()})
    for ip in ips:
        p=subprocess.run(['ip','-j','route','get',ip],capture_output=True,text=True,timeout=3)
        emit('route',{'ip':ip,'route':json.loads(p.stdout) if p.returncode==0 else None})
    for index,job in enumerate(jobs):
        delay=start+index*CADENCE-time.monotonic()
        if delay>0:time.sleep(delay)
        if time.monotonic()-start>BUDGET-15:emit('stop',{'reason':'HARD_DURATION_CAP','completed':index});return 1
        d=node({'mode':'dns'});emit('dns',d)
        if d.get('result')=='PASS' and any(x['family']==4 and x['address'] not in ips for x in d['addresses']):
            emit('stop',{'reason':'NEW_IP_REQUIRES_SEPARATE_BUDGET','completed':index});return 1
        emit('before_probe',{'index':index+1,'job':job,'resources':resources()})
        result=node(job) if job['client']=='node' else curl_probe(job['ip']) if job['client']=='curl' else openssl_probe(job['ip'])
        emit('probe',{'index':index+1,**job,**result,'resources_after':resources()})
        if result.get('error') or result.get('application_data_bytes',0) or result.get('http_request_bytes',0):
            emit('stop',{'reason':'DIAGNOSTIC_BOUNDARY_FAILURE','completed':index+1});return 1
    emit('complete',{'attempts':len(jobs),'duration_seconds':round(time.monotonic()-start,3),'http_requests':0});return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:emit('stop',{'reason':'DIAGNOSTIC_INTERNAL_FAILURE'});raise SystemExit(1)
