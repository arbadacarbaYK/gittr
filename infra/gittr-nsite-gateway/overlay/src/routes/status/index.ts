import { Hono } from "@hono/hono";
import { statusManifestsJsonRoute } from "./manifests-json.tsx";
import { siteStatusRoute } from "./site.tsx";
import { statusRoute } from "./status.tsx";

const statusRouter = new Hono();

statusRouter.on(["GET", "HEAD"], "/manifests.json", (c) =>
  statusManifestsJsonRoute(c)
);
statusRouter.on(["GET", "HEAD"], "/", (c) => statusRoute(c));
statusRouter.on(["GET", "HEAD"], "/:address", (c) => siteStatusRoute(c));

export default statusRouter;
