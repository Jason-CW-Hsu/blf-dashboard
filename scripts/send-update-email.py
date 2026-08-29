#!/usr/bin/env python3
import os
import sys
import ssl
import smtplib
from email.message import EmailMessage


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def main() -> int:
    smtp_host = env("SMTP_HOST")
    smtp_port = env("SMTP_PORT", "587")
    smtp_user = env("SMTP_USER")
    smtp_pass = env("SMTP_PASS")
    email_to = env("EMAIL_TO")
    email_from = env("EMAIL_FROM", smtp_user)
    dashboard_url = env("DASHBOARD_URL", "https://jason-cw-hsu.github.io/blf-dashboard/")
    period = env("UPDATE_PERIOD", "最新月份")

    if not smtp_host or not smtp_user or not smtp_pass or not email_to:
        print("email skipped: missing SMTP_HOST / SMTP_USER / SMTP_PASS / EMAIL_TO")
        return 0

    recipients = [addr.strip() for addr in email_to.split(",") if addr.strip()]
    if not recipients:
        print("email skipped: EMAIL_TO is empty")
        return 0

    msg = EmailMessage()
    msg["Subject"] = f"勞動基金月報更新完成｜{period}"
    msg["From"] = email_from
    msg["To"] = ", ".join(recipients)
    msg.set_content(
        "\n".join(
            [
                f"勞動基金月報已完成更新（{period}）。",
                "",
                f"儀表板：{dashboard_url}",
                "",
                "這次先直接提供儀表板連結，避免附件下載或格式相容問題。",
            ]
        )
    )

    port = int(smtp_port)
    context = ssl.create_default_context()
    server = None
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(smtp_host, port, context=context)
        else:
            server = smtplib.SMTP(smtp_host, port)
        server.ehlo()
        if port != 465:
            server.starttls(context=context)
            server.ehlo()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
    finally:
        if server is not None:
            server.quit()

    print(f"email sent to {', '.join(recipients)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
