"""판매 코드 메일 발송 — Worker 콜백으로 페이로드를 받아 네이버 SMTP로 보낸다.

GitHub Actions(workflow_dispatch)에서 JOB_ID를 받아 실행된다. 코드/이메일 원문은
Actions 입력·로그에 남기지 않고, Worker에 Bearer 시크릿 콜백으로만 가져온다.
표준 라이브러리만 사용하므로 별도 의존성 설치가 필요 없다.
"""
from __future__ import annotations

import base64
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.request
from email.header import Header
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid

NAVER_HOST = "smtp.naver.com"
NAVER_PORT = 465  # SSL

# 본문 HTML의 data: 이미지(에디터에서 삽입한 base64)를 찾아 CID 첨부로 변환한다.
# 다수 메일 클라이언트가 data: 인라인 이미지를 차단하므로 cid: 참조로 바꿔 인라인 첨부한다.
_DATA_IMG_RE = re.compile(
    r'src\s*=\s*(["\'])data:image/(?P<subtype>[a-zA-Z0-9.+-]+);base64,(?P<data>[A-Za-z0-9+/=\s]+?)\1',
    re.IGNORECASE,
)


def build_message(subject: str, html: str, mail_from: str, recipient: str):
    """HTML 안의 base64 이미지를 CID 첨부로 바꾼 메일 메시지를 만든다."""
    inline_images = []  # (cid, subtype, raw_bytes)

    def _replace(match: "re.Match") -> str:
        subtype = match.group("subtype").lower()
        try:
            raw = base64.b64decode("".join(match.group("data").split()))
        except Exception:  # noqa: BLE001 - 손상된 데이터는 원본 유지
            return match.group(0)
        cid = make_msgid(domain="charactertodo.local")[1:-1]  # <...> 제거
        inline_images.append((cid, subtype, raw))
        return f'src="cid:{cid}"'

    html_cid = _DATA_IMG_RE.sub(_replace, html)
    html_part = MIMEText(html_cid, "html", "utf-8")

    def _set_headers(message) -> None:
        # 한글 제목·발신자명은 RFC2047로 인코딩해야 메일 클라이언트에서 깨지지 않는다.
        message["Subject"] = Header(subject, "utf-8")
        message["From"] = formataddr(("캐릭터 투두", mail_from), charset="utf-8")
        message["To"] = recipient

    if not inline_images:
        _set_headers(html_part)
        return html_part

    root = MIMEMultipart("related")
    _set_headers(root)
    root.attach(html_part)
    for cid, subtype, raw in inline_images:
        image = MIMEImage(raw, _subtype=subtype)
        image.add_header("Content-ID", f"<{cid}>")
        image.add_header("Content-Disposition", "inline")
        root.attach(image)
    return root


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"환경변수 {name} 가 비어 있습니다.")
    return value


def _api(base: str, path: str, secret: str, method: str = "GET", body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{base}{path}", data=data, method=method)
    req.add_header("Authorization", f"Bearer {secret}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _report(base: str, job_id: str, secret: str, ok: bool, error: str = "") -> None:
    try:
        _api(base, f"/v1/todo/email-jobs/{job_id}/result", secret,
             method="POST", body={"ok": ok, "error": error[:300]})
    except Exception as exc:  # noqa: BLE001
        print(f"결과 보고 실패: {exc}", file=sys.stderr)


def main() -> None:
    base = _env("WORKER_BASE_URL").rstrip("/")
    secret = _env("TODO_MAIL_SECRET")
    job_id = _env("JOB_ID")
    naver_user = _env("NAVER_USER")
    naver_pass = _env("NAVER_PASS")
    mail_from = os.environ.get("MAIL_FROM", "").strip() or (
        naver_user if "@" in naver_user else f"{naver_user}@naver.com")

    try:
        payload = _api(base, f"/v1/todo/email-jobs/{job_id}/payload", secret)
        if not payload.get("ok"):
            raise RuntimeError(payload.get("error", "페이로드 응답 오류"))
        recipient = payload["recipient"]
        msg = build_message(payload["subject"], payload["html"], mail_from, recipient)

        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(NAVER_HOST, NAVER_PORT, timeout=30, context=context) as smtp:
            smtp.login(naver_user, naver_pass)
            smtp.sendmail(mail_from, [recipient], msg.as_string())
    except Exception as exc:  # noqa: BLE001
        print(f"발송 실패: {exc}", file=sys.stderr)
        _report(base, job_id, secret, False, str(exc))
        raise SystemExit(1)

    _report(base, job_id, secret, True)
    print("발송 완료")


if __name__ == "__main__":
    main()
