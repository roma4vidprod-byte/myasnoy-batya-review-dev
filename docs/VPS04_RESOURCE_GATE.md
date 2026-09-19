# VPS04 resource gate

Host: hiplet-120706, 2 vCPU, 3915 MiB RAM, no swap. Before install: available RAM 3370 MiB, used 545 MiB; disk about 35 GiB available; load .09/.03/.01.

After Auth/API/Node integration and failure tests: available RAM 3366 MiB, used 549 MiB; disk 3.2 GiB used / 35 GiB available; load .00/.00/.00. Values are actual snapshots, not reservations or load-test capacity.

Service caps: Auth 384 MiB, PostgREST 192 MiB, existing Node 256 MiB, no memory swap. DB/OS remain outside these caps. The selected idle stack leaves more than 3 GiB available and ample headroom for the synthetic gate; future worker/backup/production workloads still require separate capacity tests. No resource pressure workaround, new swap, Docker, WSL or full Supabase stack.

The local Windows test runner, not VPS, hit low-memory OOM. Its separate evidence is in VPS04_FAILURE_TESTS.md.
