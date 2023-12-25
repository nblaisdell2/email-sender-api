import express, { json, urlencoded } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import createError, { HttpError } from "http-errors";
import cors from "cors";
import { config } from "dotenv";
config();

import indexRouter from "./routes/index";

const app: Express = express();

// Makes sure our API can only accept URL-encoded strings, or JSON data
app.use(json());
app.use(urlencoded({ extended: false }));

// Adding CORS for working with cross-origin requests
// Add additional URLs to the origin array here, when necessary
app.use(cors({ origin: ["http://localhost:3000"] }));

// Define our endpoints (routers) that are made available for our API
app.use("/", indexRouter);

// success handler
app.use(async function (
  data: {
    data: any;
    message: string;
    status?: number;
  },
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (data?.status && data?.status == 500) {
    return throwExpressError(next, data.message);
  }

  if (data.message == "download") {
    return res.status(data?.status || 200).download("target/" + data.data);
  } else {
    return res
      .status(data?.status || 200)
      .json({ message: data.message, data: data.data });
  }
});

// catch 404 and forward to error handler
app.use(function (req: Request, res: Response, next: NextFunction) {
  next(createError(404));
});

// error handler
app.use(function (
  err: HttpError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.json({ error: "error" });
});

export const throwExpressError = (
  next: NextFunction,
  message: string,
  statusCode: number = 500
) => {
  next({ status: statusCode, message });
};

export default app;
