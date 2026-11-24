import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/http";

/**
 * The host services `HttpApiBuilder` asks for, for a Worker.
 *
 * workerd has no filesystem, so file-backed responses are defects and the
 * filesystem is a no-op. The platform advertises no compression: Cloudflare
 * compresses responses at the edge.
 */
export const layer: Layer.Layer<
  HttpPlatform.HttpPlatform | Etag.Generator | Path.Path | FileSystem.FileSystem
> = Layer.mergeAll(
  Etag.layer,
  Path.layer,
  FileSystem.layerNoop({}),
  Layer.succeed(
    HttpPlatform.HttpPlatform,
    HttpPlatform.HttpPlatform.of({
      platform: "web",
      compression: {
        algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
        compressResponse: (response) => Effect.succeed(response),
      },
      fileResponse: () => Effect.die("HttpPlatform.fileResponse is not supported on workerd"),
      fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse is not supported on workerd"),
    }),
  ),
);
