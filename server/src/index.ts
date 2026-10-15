import { startServer } from "./server";

const port = Number(process.env.PORT ?? 4000);
startServer(port).then(({ port }) => {
  console.log(`watch-party sync server listening on :${port}`);
});
