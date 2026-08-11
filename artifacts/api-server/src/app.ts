import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

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

app.use(express.static(publicDir, { index: false }));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use("/api", router);

export default app;
