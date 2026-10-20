# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 3.x     | Yes       |
| < 3.0   | No        |

Only the latest 3.x release receives fixes: the `green-tunnel` package on npm, the
`sadeghhayeri/green-tunnel` Docker image and the desktop app. v2 was replaced by a ground-up rewrite
and is no longer maintained.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Email **hayerisadegh@gmail.com**
instead, with:

- the version and how you run it (CLI, Docker or desktop app, and on which OS);
- what an attacker can do, and from where (a proxy client, the network path to the DNS resolver, an
  upstream server, a local process);
- steps or a script that reproduce it.

Fixes are released as a new 3.x version, and the reporter is credited in the release notes unless
they would rather not be.

## What counts

GreenTunnel is used on censored networks, so beyond crashes and code execution, anything that lets
the network see which host a user is visiting while fragmentation and encrypted DNS are enabled is
a security issue: an unfragmented SNI, a silent fallback to plain DNS, or a forged DNS answer that
is accepted.

The proxy is unauthenticated by design and binds to `127.0.0.1` by default. That it can reach any
address, including private networks, or that anyone can use it once you bind it to a public
interface, is expected behaviour. Whether a particular DPI system can still detect the traffic is a
question of how well the evasion works, not a vulnerability; please open a regular issue for that.
