import ctypes,importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('diag',Path(__file__).with_name('reliability.py'))
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class F:
    def __init__(self,fn):self.fn=fn
    def __call__(self,*a):return self.fn(*a)
class Tests(unittest.TestCase):
    def test_budget_and_per_ip(self):
        ips=['192.0.2.1','192.0.2.2','192.0.2.3'];jobs=d.plan(ips)
        self.assertEqual(len(jobs),54);self.assertLess((len(jobs)-1)*d.CADENCE+12,d.BUDGET)
        for ip in ips:
            self.assertEqual(sum(x.get('ip')==ip and x['mode']=='tcp' for x in jobs),10)
            for client in ('node','curl','openssl'):
                self.assertEqual(sum(x.get('ip')==ip and x['mode']=='tls' and x['client']==client for x in jobs),2)
    def test_family_pairs(self):
        p=d.plan(['192.0.2.1'])
        for family in (0,4):self.assertEqual(sum(x.get('family')==family for x in p),3)
    def test_budget_guard(self):
        for ips in ([],['192.0.2.1']*4):
            with self.assertRaises(ValueError):d.plan(ips)
    def test_ip_guard(self):
        for value in ('foreign.invalid','::1','not an address'):
            with self.assertRaises(ValueError):d.valid_ip(value)
    def test_openssl_success(self):
        r=d.openssl_projection('PRIVATE_SENTINEL\nCONNECTION ESTABLISHED\nProtocol version: TLSv1.3\nVerification: OK',0,False,75)
        self.assertEqual(r['result'],'PASS');self.assertNotIn('PRIVATE_SENTINEL',json.dumps(r))
    def test_openssl_tls_timeout(self):
        r=d.openssl_projection('SSL_connect:before SSL initialization',None,True,10000)
        self.assertEqual(r['timeout_phase'],'TLS_HANDSHAKE');self.assertEqual(r['result'],'FAIL')
    def test_openssl_connect_timeout(self):
        self.assertEqual(d.openssl_projection('',None,True,10000)['timeout_phase'],'TCP_CONNECT')
    def test_openssl_bad_cert_denied(self):
        self.assertEqual(d.openssl_projection('CONNECTION ESTABLISHED\nProtocol version: TLSv1.3',1,False,75)['result'],'FAIL')
    def test_child_error_redacted_no_retry(self):
        with patch.object(d.subprocess,'run',side_effect=RuntimeError('PRIVATE_SENTINEL')) as m:
            r=d.node({'mode':'tcp','ip':'192.0.2.1'});self.assertEqual(m.call_count,1)
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(r));self.assertEqual(r['error'],'DIAGNOSTIC_CHILD_UNAVAILABLE')
    def test_curl_connect_only_and_verification(self):
        opts={};calls=[]
        class Lib:pass
        lib=Lib()
        lib.curl_easy_init=F(lambda:1)
        def option(h,k,v):opts[k]=v;return 0
        lib.curl_easy_setopt=F(option)
        def info(h,k,v):
            if k in (0x300005,0x300021):v._obj.value=0.03
            return 0
        lib.curl_easy_getinfo=F(info);lib.curl_easy_perform=F(lambda h:calls.append(h) or 0)
        lib.curl_easy_cleanup=F(lambda h:None);lib.curl_slist_append=F(lambda h,s:2);lib.curl_slist_free_all=F(lambda h:None)
        with patch.object(d.c,'CDLL',return_value=lib),patch.object(d.ctypes.util,'find_library',return_value='fake'):
            r=d.curl_probe('192.0.2.1')
        for k,v in [(141,1),(64,1),(81,2),(52,0),(156,10000),(155,10000)]:self.assertEqual(opts[k].value,v)
        self.assertEqual(opts[10004].value,b'');self.assertEqual(len(calls),1);self.assertEqual(r['http_request_bytes'],0)
        self.assertEqual(r['result'],'PASS')
if __name__=='__main__':unittest.main()
