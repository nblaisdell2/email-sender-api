# Email Sender API

This is an ExpressJS REST API which uses the `node-imap` and `Nodemailer` libraries in order to read and send emails in a programmatic way, without having to implement the same functionality in various other languages/technologies.

- [Confluence Project Page](https://nblaisdell.atlassian.net/wiki/spaces/~701210f4b5f4c121e4cd5804ebc078dd6b379/pages/70975489/Email+Sender+API)

## Setup

#### Forking/Cloning

To clone this project, follow these steps:

1. Create a `.env` file, and add a `PORT` variable. - If not provided, the default is port `3000`.

```bash
PORT=3000

EMAIL_USER="" # gmail user
EMAIL_PWD=""  # gmail "app" password
```

- To learn more about how to create an "application" password for Gmail, and for setting up our Gmail account to be able to be used for this API, see [the following steps](https://nblaisdell.atlassian.net/wiki/spaces/~701210f4b5f4c121e4cd5804ebc078dd6b379/pages/68124705/Nodemailer#1.-Enable-IMAP-in-your-Gmail-account).
  <br/>

2. Install the dependencies for the project
   `npm install`
   <br/>
3. Run the project
   `npm run dev`

#### Using CI/CD

This project includes files which allow for GitHub Actions & AWS CodeBuild to build and deploy
the API to AWS automatically. In order for these files to work correctly, the following steps will need to happen:

1. In AWS, create an AWS GitHub Actions role which will perform certain actions within AWS on our behalf from the GitHub Actions script.

- In IAM, create a new "Identity Provider" which connects to the GitHub repo
- Then, create an IAM Role which uses our Identity Provider as the Trust Relationship
- Then, for that same role, add the following policy for its permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisualEditor0",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:AddPermission",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "iam:PassRole",
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy",
        "apigateway:*",
        "ecr:*",
        "codebuild:*",
        "codedeploy:CreateApplication",
        "codedeploy:CreateDeploymentGroup",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

2. In the "Settings" tab of this repository in GitHub, under Security->Secrets and Variables->Actions, add the following secret values:

- `AWS_REGION`
- `AWS_ACCOUNT_ID`
- `AWS_GHACTIONS_ROLENAME`
- `AWS_LAMBDA_EXEC_ARN`

Once these two steps are completed, the `create_aws_api.sh` will run properly and be able to perform all the necessary actions needed to provision the AWS resources needed for our API to be available.

For more info on this process, view my tutorial here:

- [Deploy an API via Lambda & API Gateway](https://nblaisdell.atlassian.net/wiki/spaces/~701210f4b5f4c121e4cd5804ebc078dd6b379/pages/45383681/Deploy+an+API+on+Lambda+API+Gateway)

---

## Endpoints

**API Base URL:** https://ntfxfxksvd.execute-api.us-east-1.amazonaws.com/dev

| Method                                                                  | Endpoint           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <span style="color:#6BDD9A;font-weight:bold;font-size:18px">GET</span>  | `/getEmailFolders` | Gets the list of available folders to search for emails in within the connected IMAP account                                                                                                                                                                                                                                                                                                                                                                                              |
| <span style="color:#6BDD9A;font-weight:bold;font-size:18px">GET</span>  | `/getEmails`       | Gets the list of emails in an email folder (or INBOX, by default). <br/> <br/> Additional optional parameters mentioned to the left can be used to adjust the results returned in this response.                                                                                                                                                                                                                                                                                          |
| <span style="color:#6BDD9A;font-weight:bold;font-size:18px">GET</span>  | `/getEmail`        | Gets a single email, given its `msgID`. <br/><br/>Includes any headers and attachments automatically.                                                                                                                                                                                                                                                                                                                                                                                     |
| <span style="color:#6BDD9A;font-weight:bold;font-size:18px">GET</span>  | `/getAttachment`   | Downloads a single attachment from an email, given its msgID and the name of the file that should be downloaded.<br/><br/>NOTE: A limitation of IMAP is that we are unable to download all of the attachments in a single request. To work around this, we can simply make multiple requests to this endpoint for all of the files/attachments we want to download from a particular email.                                                                                               |
| <span style="color:#6BDD9A;font-weight:bold;font-size:18px">POST</span> | `/sendEmail`       | Sends an email from my personal Gmail account to a (comma-separated) list of recipients.<br/><br/>Can use the `text` property to use plaintext in the email, or set the `html` property with some valid HTML to display that in the email instead.<br/><br/>We can use the `fromName` parameter to display a different sender, even though the email will still be my own.<br/><br/>Lastly, we can include attachments, which is a complex object that is described in more detail below. |

#### Attachments Object examples

```json
[
  // Not an attachment, but an embedded image within the email
  {
    "filename": "evercent_logo.png",
    "displayFileName": "evercent_logo.png",
    "useCDN": true,
    "embeddedImage": true,
    "base64Content": null
  },
  // Same image as above, but separately included as an attachment, as well
  {
    "filename": "evercent_logo.png",
    "displayFileName": "evercent_logo.png",
    "useCDN": true,
    "embeddedImage": false,
    "base64Content": null
  },
  // Attachment #2
  {
    "filename": "Document.pdf",
    "displayFileName": "Document.pdf",
    "useCDN": true,
    "embeddedImage": false,
    "base64Content": null
  },
  // Attachment #3 - renamed original file when including attachment
  {
    "filename": "VEHICLE-PHOTOS.pdf",
    "displayFileName": "vehicle_report.pdf",
    "useCDN": true,
    "embeddedImage": false,
    "base64Content": null
  }
]
```
