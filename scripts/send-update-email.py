#!/usr/bin/env python3
import os
import sys
import ssl
import smtplib
from email.message import EmailMessage
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def main() -> int:
    smtp_host = env("SMTP_HOST")
    smtp_port = env("SMTP_PORT", "587")
    smtp_user = env("SMTP_USER")
    smtp_pass = env("SMTP_PASS")
    email_to = env("EMAIL_TO")
    email_from = env("EMAIL_FROM", smtp_user)
    excel_path = Path(env("UPDATE_EXCEL_PATH", "outputs/blf-monthly-disclosure/勞動基金月度揭露_可持續更新.xlsx"))
    dashboard_url = env("DASHBOARD_URL", "https://jason-cw-hsu.github.io/blf-dashboard/")
    period = env("UPDATE_PERIOD", "最新月份")

    if not smtp_host or not smtp_user or not smtp_pass or not email_to:
        print("email skipped: missing SMTP_HOST / SMTP_USER / SMTP_PASS / EMAIL_TO")
        return 0

    if not excel_path.exists():
        raise FileNotFoundError(f"找不到 Excel 檔：{excel_path}")

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
                f"Excel：已附檔 {excel_path.name}",
                "",
                "如果你要看最新內容，先開儀表板，再下載附件即可。",
            ]
        )
    )

    msg.add_attachment(excel_path.read_bytes(), maintype="application", subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=excel_path.name)

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
