import { createServer, proxy } from "aws-serverless-express";
import app from "./app";
import serverlessExpress from "@codegenie/serverless-express";

// // Create HTTP server.
// const server = createServer({...app, },()=>{},["*/*"]);

// server.on("error", onError);
// server.on("listening", onListening);

// // Event listener for HTTP server "error" event.
// function onError(error: any) {
//   if (error.syscall !== "listen") {
//     throw error;
//   }

//   // handle specific listen errors with friendly messages
//   switch (error.code) {
//     case "EACCES":
//       console.error("requires elevated privileges");
//       process.exit(1);
//       break;
//     case "EADDRINUSE":
//       console.error("already in use");
//       process.exit(1);
//       break;
//     default:
//       throw error;
//   }
// }

// // Event listener for HTTP server "listening" event.
// function onListening() {
//   const addr = server.address();
//   const bind = typeof addr === "string" ? "pipe " + addr : "port " + addr?.port;
//   console.log(`Listening on ${bind}`);
// }

exports.handler = serverlessExpress({
  app,
  binarySettings: {
    isBinary: true,
    contentTypes: ["application/pdf"],
  },
});

// exports.handler = (event: any, context: any) => {
//   proxy(server, event, context);
// };
