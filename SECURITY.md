# Security

## Reporting

Email `jakob@bjelver.se` with the details, or open a private security advisory on GitHub. Please do
not open a public issue for a vulnerability. Expect an answer within a few days; this is a
single-person project, not a company.

## What this software assumes

- **It is not multi-tenant.** One owner, no accounts, no roles. Isolation is the proxy in front of it.
- **The proxy is the door.** The binary trusts whoever can reach it; run it on a private network or
  behind an authenticating proxy and never publish the port.
- **Public links are public.** A `public` paste is readable by anyone with the URL. It must expire and
  it cannot burn; a password is a hash in the row and a signed cookie in the browser, not a session.
- **Files are served, not executed.** Only images (except SVG), PDFs and plain text render inline;
  everything else is an attachment, and HTML is never rendered from the app's own origin.
