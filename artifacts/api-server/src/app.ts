import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
// Plain-JS bot-owned platform services; preview is REST-only, not a bot launch.
// @ts-expect-error Bot modules intentionally retain their existing JavaScript stack.
import { platformDev } from "../../../apps/agent-smith/src/platform/dev-adapter.js";

const app: Express = express();
app.use("/api/platform", (req, res) => {
  void platformDev.handler(req, res);
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
