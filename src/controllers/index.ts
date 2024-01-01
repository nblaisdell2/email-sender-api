import { Request, Response, NextFunction } from "express";
import {
  getAllEmailFolders,
  getAttachment,
  getEmailMessages,
  sendEmailMessage,
} from "../utils/email";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "fs";

export const getEmailFolders = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const allFolderData = await getAllEmailFolders();

  next({
    status: 200,
    message: "Retrieved folders successfully!",
    data: {
      count: allFolderData.length,
      folders: allFolderData,
    },
  });
};

export const getEmails = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { limit, since, reverse, body, header, folder, attachments, msgID } =
    req.query;

  const allEmails = await getEmailMessages({
    folderName: (folder as string) || "INBOX",
    includeBody: body == "1",
    includeHeader: header == "1",
    includeAttachments: attachments == "1",
    searchCriteria: {
      messageType: "ALL",
      messageID: msgID as string,
      dateSearch: {
        date: since as string,
        operator: since ? "since" : null,
      },
      headerSearch: {},
    },
  });

  let messagesFiltered = allEmails
    .filter((m) => m.msgID != "")
    .sort((a, b) =>
      reverse == "1"
        ? new Date(b.dateSent).getTime() - new Date(a.dateSent).getTime()
        : new Date(a.dateSent).getTime() - new Date(b.dateSent).getTime()
    );

  if (limit) {
    messagesFiltered = messagesFiltered.slice(0, Number(limit));
  }

  next({
    status: 200,
    message: "Retrieved emails successfully!",
    data: {
      count: messagesFiltered.length,
      emails: messagesFiltered,
    },
  });
};

export const getEmailByID = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { folder, body, msgID } = req.query;

  if (!(msgID && folder)) {
    next({
      status: 500,
      message:
        "Must provide the 'msgID' & 'folder' parameters to find an email",
    });
  }

  const emailResults = await getEmailMessages({
    folderName: folder as string,
    includeBody: body == "1",
    includeHeader: true,
    includeAttachments: true,
    searchCriteria: {
      messageType: "ALL",
      messageID: msgID as string,
      dateSearch: {
        date: "",
        operator: null,
      },
      headerSearch: {},
    },
  });

  next({
    status: 200,
    message: "Retrieved email successfully!",
    data: emailResults.filter((m) => m.msgID != "")[0],
  });
};

export const getAttachments = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { folder, filename, msgID } = req.query;

  if (!(msgID && folder && filename)) {
    next({
      status: 500,
      message:
        "Must provide the 'msgID', 'folder' & 'filename' parameters to download an attachment",
    });
  }

  const attachmentURL = await getAttachment({
    folderName: folder as string,
    includeBody: false,
    includeHeader: true,
    includeAttachments: true,
    searchCriteria: {
      messageType: "ALL",
      messageID: msgID as string,
      dateSearch: {
        date: "",
        operator: null,
      },
      headerSearch: {},
    },
    download: {
      filename: filename as string,
    },
  });
  console.log("FINISHED (getAttachment)");

  const s3Client = new S3Client({});

  console.log("Uploading to S3 bucket", attachmentURL);
  const s3result = await s3Client.send(
    new PutObjectCommand({
      Bucket: "public-email-images-001",
      Key: "attachments/" + filename,
      Body: createReadStream(attachmentURL),
    })
  );

  console.log("S3 Result:", s3result);
  console.log("Uploading to S3 bucket & Generating URL...");
  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: "public-email-images-001",
      Key: "attachments/" + filename,
    }),
    { expiresIn: 3600 }
  );

  console.log("URL:", url);

  next({
    status: 200,
    message: "Attachment available at the following URL",
    data: url,
  });
};

export const sendEmail = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const info = await sendEmailMessage(req);

  next({
    status: 200,
    message: "Email sent successfully!",
    data: info.messageId,
  });
};
