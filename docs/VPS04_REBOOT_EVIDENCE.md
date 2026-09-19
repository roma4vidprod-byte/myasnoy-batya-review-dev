# VPS04 controlled reboot

**REBOOT = NOT_RUN / BLOCKED_RESCUE_NOT_VERIFIED**.

Read-only HipHosting panel access succeeded for the correct VPS. However the VNC canvas had zero dimensions and Ctrl+Alt+Del was disabled. This does not prove a usable independent rescue console. No password reset, console login, power action or reboot performed.

Autostart is verified:

* `ssh.socket` enabled and active (the socket-activated `ssh.service` itself being disabled is not a failure);
* `postgresql.service` enabled, cluster start.conf = `auto`, 17-main active;
* `review-lab-auth`, `review-lab-api`, `review-activator-foundation` enabled and active.

UFW active, only 22/tcp IPv4/IPv6 allowed. Auth/API/DB/Node listen on 127.0.0.1 only. Service restarts already passed, but they are NOT substituted for a full VPS reboot.

Next action required: establish a working provider rescue/VNC console. Only then may the already requested controlled reboot acceptance proceed. No full PASS_MINIMAL_BACKEND until actual reboot evidence exists.
