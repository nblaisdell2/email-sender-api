import request = require("supertest");
import app from "../src/app";

describe("The Main API", () => {
  it("should return a status 200 & a Message", () => {
    return request(app).get("/getEmailFolders").expect(200);
  });
});
