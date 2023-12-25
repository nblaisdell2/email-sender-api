import { Request, Response, NextFunction } from "express";
import Imap from "node-imap";
import { createTransport } from "nodemailer";
import { Base64Decode } from "base64-stream";
import { createWriteStream, existsSync, mkdirSync, rm } from "fs";
import { emptyDirSync } from "fs-extra";
import client from "https";

type EmailMsg = {
  msgID: string;
  dateSent: string;
  from: string;
  subject: string;
  to: string;
  body?: string;
  header?: {
    [key: string]: string;
  };
  attachments: EmailAttachment[];
};

type EmailAttachment = {
  filename: string;
  type: string;
  encoding: string;
  size: number;
};

type MailConfig = {
  folderName: string;
  includeBody: boolean;
  includeHeader: boolean;
  includeAttachments: boolean;
  searchCriteria: {
    messageType: "ALL" | "DELETED" | "UNSEEN";
    messageID?: string;
    subject?: string;
    to?: string;
    body?: string;
    from?: string;
    dateSearch: {
      date?: string;
      operator: null | "before" | "on" | "since";
    };
    headerSearch: {
      [key: string]: string;
    };
  };
  download?: {
    filename: string;
  };
};

// Overall type for configuring the send mail function for Nodemailer
type SendMailConfig = {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: SendMailAttachment[];
};

// Used within the overall SendEmail configuration, for defining the
// attachments data needed for nodemailer
type SendMailAttachment = {
  path?: string; // Absolute path to a locally available file
  filename?: string; // File name part of file, used for attachment name
  cid?: string; // unique value, used for embedding images in HTML
  content?: string; // Base64-encoded string representing the attachment file
  encoding?: undefined | "base64"; // should be set to "base64" when using "content"
};

// Separate attachment type used for including attachments as part of
// the "sendEmail" endpoint
type Attachment = {
  filename: string; // filename of the file to include as an attachment
  displayFileName?: string; // separate name used to override the filename when attaching
  useCDN: boolean; // if true, downloads the file from the CDN before attaching
  embeddedImage: boolean; // if true, embeds the image into the HTML rather than including an attachment
  base64Content?: string; // if set, uses the Base64-encoded string to attach the file
};

const ATTACHMENTS_LOCATION = "target";
const IMG_CDN = process.env.IMG_CDN;

const imap = new Imap({
  user: process.env.EMAIL_USER as string,
  password: process.env.EMAIL_PWD as string,
  host: "imap.gmail.com",
  port: 993,
  tls: true,
});

export async function runImapCommand<T>(
  imapFn: (resolve: (value: T) => T, reject: (reason?: any) => void) => void,
  formatter?: (results: T) => any
) {
  imap.connect();

  return new Promise<any>((resolve, reject) => {
    let results: any;

    imap.once("ready", async function () {
      results = await new Promise((resolve, reject) => {
        imapFn(resolve as (value: T) => T, reject);
      });

      imap.end();
    });

    imap.once("error", function (err) {
      console.log(err);
      reject({ err });
    });

    imap.once("end", function () {
      // console.log("Connection ended");

      if (formatter) {
        results = formatter(results);
      }

      resolve(results);
    });
  });
}

export function readImapMailbox(
  resolve: (value: unknown) => any,
  reject: (reason?: any) => void,
  config: MailConfig
) {
  imap.openBox(config.folderName, (err, box) => {
    if (err) reject(err);

    const { messageType, messageID, headerSearch, dateSearch } =
      config.searchCriteria;

    let searchCriteria: any[] = [messageType];
    if (dateSearch.operator) {
      searchCriteria.push([
        "SENT" + dateSearch.operator.toUpperCase(),
        dateSearch.date,
      ]);
    }
    if (messageID) {
      searchCriteria.push(["HEADER", "message-id", messageID]);
    }
    if (headerSearch) {
      const headerKeys = Object.keys(headerSearch);
      for (let i = 0; i < headerKeys.length; i++) {
        const key = headerKeys[i];
        searchCriteria.push(["HEADER", key, headerSearch[key]]);
      }
    }
    // console.log("Search Critiera?", searchCriteria);

    imap.search(searchCriteria, (err, results) => {
      if (err) reject(err);

      let allMsgs = Array(box.messages.total)
        .fill(undefined)
        .map((x) => {
          let newEmailMsg: any = {
            msgID: "",
            dateSent: "",
            from: "",
            subject: "",
            to: "",
            attachments: [],
          };
          if (config.includeBody) newEmailMsg["body"] = "";
          if (config.includeHeader) newEmailMsg["header"] = {};
          return newEmailMsg as EmailMsg;
        });

      const fetch = imap.fetch(results, {
        bodies: config.includeBody ? ["HEADER", "TEXT"] : ["HEADER"],
        struct: true,
      });

      fetch.on("message", function (msg, seqno) {
        var prefix = "(#" + seqno + ") ";
        var buffer = "",
          count = 0;
        msg.on("body", function (stream, info) {
          // console.log("info?", info);
          var buffer = "";
          stream.on("data", function (chunk) {
            // count += chunk.length;
            buffer += chunk.toString("utf8");
          });
          stream.once("end", function () {
            if (info.which !== "TEXT") {
              let parsedHeader: any = Imap.parseHeader(buffer);

              allMsgs[seqno - 1].to = parsedHeader.to
                ? parsedHeader.to[0]
                : "unknown sender";
              allMsgs[seqno - 1].from = parsedHeader.from[0];
              allMsgs[seqno - 1].subject = parsedHeader.subject
                ? parsedHeader.subject[0]
                : "unknown subject";
              allMsgs[seqno - 1].dateSent = new Date(
                parsedHeader.date[0]
              ).toISOString();
              allMsgs[seqno - 1].msgID = parsedHeader["message-id"][0];

              if (config.includeHeader) {
                allMsgs[seqno - 1].header = parsedHeader;
              }
            } else {
              allMsgs[seqno - 1].body = buffer
                .replace(/(<([^>]+)>)/gi, "")
                .trim();
            }
          });
        });

        msg.once("attributes", function (attrs) {
          if (config.includeAttachments) {
            // console.log(attrs);

            const parts = attrs.struct;
            if (parts[0].type == "mixed") {
              for (let i = 1; i < parts.length; i++) {
                const currPart = parts[i][0];
                if (currPart.disposition?.type.toUpperCase() == "ATTACHMENT") {
                  const attFileName =
                    currPart.disposition.params?.filename ||
                    currPart.params?.name;

                  allMsgs[seqno - 1].attachments.push({
                    filename: attFileName,
                    encoding: currPart.encoding,
                    size: currPart.size,
                    type: currPart.type + "/" + currPart.subtype,
                  });

                  if (
                    config.download &&
                    config.download.filename == attFileName
                  ) {
                    const f = imap.fetch(attrs.uid, {
                      //do not use imap.seq.fetch here
                      bodies: [currPart.partID],
                      struct: true,
                    });
                    //build function to process attachment message
                    f.on("message", buildAttMessageFunction(currPart));
                  }
                }
              }
            }
          }
        });

        msg.once("end", function () {
          // console.log(prefix + "Finished");
        });
      });

      fetch.once("error", function (err) {
        reject(err);
        // console.log("Fetch error: " + err);
      });
      fetch.once("end", function () {
        resolve(allMsgs);
      });
    });
  });
}

function buildAttMessageFunction(attachment: any) {
  var filename = attachment.params.name;
  var encoding = attachment.encoding;

  return function (msg: Imap.ImapMessage, seqno: number) {
    var prefix = "(#" + seqno + ") ";
    msg.on("body", function (stream, info) {
      //Create a write stream so that we can stream the attachment to file;
      console.log(
        prefix + "Streaming this attachment to file",
        ATTACHMENTS_LOCATION + "/" + filename,
        info
      );
      var writeStream = createWriteStream(
        ATTACHMENTS_LOCATION + "/" + filename
      );
      writeStream.on("finish", function () {
        console.log(
          prefix + "Done writing to file %s",
          ATTACHMENTS_LOCATION + "/" + filename
        );
      });

      //stream.pipe(writeStream); this would write base64 data to the file.
      //so we decode during streaming using
      if (toUpper(encoding) === "BASE64") {
        //the stream is base64 encoded, so here the stream is decode on the fly and piped to the write stream (file)
        stream.pipe(new Base64Decode()).pipe(writeStream);
      } else {
        //here we have none or some other decoding streamed directly to the file which renders it useless probably
        stream.pipe(writeStream);
      }
    });
    msg.once("end", function () {
      console.log(
        prefix + "Finished attachment %s",
        ATTACHMENTS_LOCATION + "/" + filename
      );
    });
  };
}

function toUpper(thing: string) {
  return thing && thing.toUpperCase ? thing.toUpperCase() : thing;
}

function downloadImage(url: string, filepath: string) {
  client.get(url, (res) => {
    res.pipe(createWriteStream(filepath));
  });
}

// Recursive function which goes through a root IMAP mailbox and generates a list
// of all the available folder paths from that root mailbox
const getFolderPaths = (
  mailboxes: Imap.MailBoxes,
  currentPath: string,
  folderName?: string
): string[] => {
  let paths: string[] = [];

  if (!folderName) {
    const parentFolders = Object.keys(mailboxes);
    for (let i = 0; i < parentFolders.length; i++) {
      paths.push(...getFolderPaths(mailboxes, currentPath, parentFolders[i]));
    }
  } else {
    const box = mailboxes[folderName];
    currentPath += (currentPath == "" ? "" : "/") + folderName;

    if (box.children) {
      paths.push(...getFolderPaths(box.children, currentPath));
    } else {
      paths.push(currentPath);
    }
  }

  return paths;
};

// ========================================================
// ========================================================
// ========================================================

export const getEmailFolders = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.log("getting email folders?");

  const allFolderData = await runImapCommand<string[]>(
    (resolve, reject) => {
      imap.getBoxes((err, mailboxes: Imap.MailBoxes) => {
        if (err) reject(err);

        const results = getFolderPaths(mailboxes, "");
        resolve(results);
      });
    },
    (results) => {
      return {
        count: results.length,
        folders: results,
      };
    }
  );

  next({
    status: 200,
    message: "Retrieved folders successfully!",
    data: allFolderData,
  });
};

export const getEmails = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { limit, since, reverse, body, header, folder, msgID } = req.query;

  const allEmails = await runImapCommand<EmailMsg[]>(
    (resolve, reject) => {
      readImapMailbox(resolve as (value: any) => any, reject, {
        folderName: (folder as string) || "INBOX",
        includeBody: body == "1",
        includeHeader: header == "1",
        includeAttachments: true,
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
    },
    (results) => {
      let messagesFiltered = results
        .filter((m) => m.msgID != "")
        .sort((a, b) =>
          reverse == "1"
            ? new Date(b.dateSent).getTime() - new Date(a.dateSent).getTime()
            : new Date(a.dateSent).getTime() - new Date(b.dateSent).getTime()
        );

      if (limit) {
        messagesFiltered = messagesFiltered.slice(0, Number(limit));
      }

      return {
        count: messagesFiltered.length,
        emails: messagesFiltered,
      };
    }
  );

  next({
    status: 200,
    message: "Retrieved emails successfully!",
    data: allEmails,
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

  const email = await runImapCommand<EmailMsg[]>(
    (resolve, reject) => {
      readImapMailbox(resolve as (value: any) => any, reject, {
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
    },
    (results) => {
      return results.filter((m) => m.msgID != "")[0];
    }
  );

  next({
    status: 200,
    message: "Retrieved email successfully!",
    data: email,
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

  // Create (or empty) the target directory for attachments before downloading
  if (!existsSync(ATTACHMENTS_LOCATION)) {
    mkdirSync(ATTACHMENTS_LOCATION, { recursive: true });
  } else {
    emptyDirSync(ATTACHMENTS_LOCATION);
  }

  await runImapCommand<EmailMsg[]>(
    (resolve, reject) => {
      readImapMailbox(resolve as (value: any) => any, reject, {
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
    },
    (results) => {
      return results.filter((m) => m.msgID != "")[0];
    }
  );

  next({
    status: 200,
    message: "download",
    data: filename,
  });
};

const getSendMailConfig = ({
  from,
  fromName,
  to,
  subject,
  text,
  html,
  cc,
  bcc,
  attachments,
}: any): [SendMailConfig, string[]] => {
  const sender = fromName
    ? '"' + fromName + '" <' + from + ">"
    : "<" + from + ">";
  let sendMailConfig: SendMailConfig = {
    from: sender, // sender address
    to, // list of receivers
    subject, // Subject line
  };

  if (html) {
    sendMailConfig["html"] = html as string;
  } else {
    sendMailConfig["text"] = text as string;
  }

  if (cc) sendMailConfig["cc"] = cc as string;
  if (bcc) sendMailConfig["bcc"] = bcc as string;

  let downloadedImgs: string[] = [];
  if (attachments) {
    sendMailConfig["attachments"] = [];

    const atts = JSON.parse(attachments);
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i] as Attachment;
      const currPath = ATTACHMENTS_LOCATION + "/" + att.filename;
      let attConfig: SendMailAttachment;

      if (att.useCDN && !downloadedImgs.includes(currPath)) {
        downloadImage(IMG_CDN + "/" + att.filename, currPath);

        // keep track of downloaded images, so we can delete them later
        downloadedImgs.push(currPath);
      }

      if (att.embeddedImage) {
        // Embedded image
        // NOTE: Make sure to adjust images "src" attribute in HTML
        //       so it matches the filename included here
        attConfig = {
          filename: att.displayFileName || att.filename,
          path: currPath,
          cid: att.filename,
        };
      } else if (att.base64Content) {
        // Base64-encoded string attachment type
        attConfig = {
          filename: att.displayFileName || att.filename,
          encoding: "base64",
          content: att.base64Content,
        };
      } else {
        // Regular attachment
        attConfig = {
          filename: att.displayFileName || att.filename,
          path: currPath,
        };
      }

      sendMailConfig["attachments"].push(attConfig);
    }
  }

  return [sendMailConfig, downloadedImgs];
};

export const sendEmail = async function (
  req: Request,
  res: Response,
  next: NextFunction
) {
  const transporter = createTransport({
    host: "smtp.gmail.com",
    port: 465,
    //   secure: true,
    auth: {
      user: process.env.EMAIL_USER as string,
      pass: process.env.EMAIL_PWD as string,
    },
  });

  const [sendMailConfig, downloadedImgs] = getSendMailConfig(req.body);
  const info = await transporter.sendMail(sendMailConfig);

  // Delete any downloaded images (during configuration setup) before exiting
  for (let i = 0; i < downloadedImgs.length; i++) {
    rm(downloadedImgs[i], (err) => {});
  }

  next({
    status: 200,
    message: "Email sent successfully!",
    data: info.messageId,
  });
};
