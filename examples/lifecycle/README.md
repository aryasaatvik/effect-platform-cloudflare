# Lifecycle example

This example deploys two Workers. The caller reaches the API only through a Cloudflare service
binding and verifies cold initialization, Effect-based background work, streaming scope transfer,
and abort finalization. A Durable Object records lifecycle transitions so verification does not
depend on hitting the same Worker isolate twice.

Deploy the API before the caller:

```sh
bun run deploy:lifecycle-api
bun run deploy:lifecycle-caller
```

Then request the caller's `/` endpoint. It returns one JSON acceptance report covering every seam.
