import express, { Router } from "express";
import {
  sendEmail,
  getEmails,
  getAttachments,
  getEmailFolders,
  getEmailByID,
} from "../controllers/index";

const router: Router = express.Router();

// Define the routes and methods available for each route
router.route("/getAttachments").get(getAttachments);
router.route("/getEmails").get(getEmails);
router.route("/getEmail").get(getEmailByID);
router.route("/getEmailFolders").get(getEmailFolders);
router.route("/sendEmail").post(sendEmail);

export default router;
