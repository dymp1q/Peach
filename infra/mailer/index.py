"""report-mailer: a new reports/<week>.csv in S3 -> one email with it attached."""
import json
import os
import urllib.parse
from email.message import EmailMessage

import boto3

s3 = boto3.client("s3")
ses = boto3.client("sesv2")


def log(message, **fields):
    print(json.dumps({"level": "INFO", "message": message, **fields}))


def handler(event, context):
    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        # Keys arrive URL-encoded: "2026-W40.csv" stays, spaces become "+".
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        week = key.rsplit("/", 1)[-1].removesuffix(".csv")
        log("report-mailer triggered", trigger="s3",
            event=record["eventName"], bucket=bucket, key=key, week=week)

        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        recipients = [r.strip() for r in os.environ["RECIPIENTS"].split(",") if r.strip()]

        msg = EmailMessage()
        msg["Subject"] = f"Spry weekly meetings report, {week}"
        msg["From"] = os.environ["SENDER"]
        msg["To"] = ", ".join(recipients)
        msg.set_content(
            f"Hi,\n\nattached is the Spry meetings report for {week}: the number "
            "of meetings and their hours, compared with the week before, and the "
            "five longest meetings.\n\nThis email was sent automatically.\n"
        )
        msg.add_attachment(body, maintype="text", subtype="csv",
                           filename=f"spry-report-{week}.csv")

        sent = ses.send_email(
            FromEmailAddress=os.environ["SENDER"],
            Destination={"ToAddresses": recipients},
            Content={"Raw": {"Data": msg.as_bytes()}},
        )
        log("report emailed", trigger="s3", key=key,
            recipients=len(recipients), message_id=sent["MessageId"])
