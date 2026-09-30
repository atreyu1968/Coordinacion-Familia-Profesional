import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        const url = req.url?.split("?")[0]?.replace(
          /(\/lms\/scorm\/sessions\/)[^/]+(?=\/content\/)/,
          "$1[redacted]",
        );
        return {
          id: req.id,
          method: req.method,
          url,
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
app.use(
  express.json({
    // File uploads are raw PUT bodies even when the file itself has a JSON MIME
    // type. Leave those streams untouched for the storage routes.
    type: (req) => {
      const requestPath = req.url?.split("?")[0] || "";
      const isRawUpload =
        req.method === "PUT" &&
        /^\/api\/storage\/(?:local-upload|cloud-upload)\//.test(requestPath);
      const contentType = req.headers["content-type"];
      const isJson =
        typeof contentType === "string" &&
        /^application\/json(?:\s*;|$)/i.test(contentType);
      return !isRawUpload && isJson;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
