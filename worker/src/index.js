// _inbox 커밋 프록시 Worker
// -----------------------------------------------------------------------------
// 빌더(docs/index.html)가 만든 파일(zip / delete.json / 해금코드 json)을
// 이 Worker로 POST 하면, 서버에 보관된 GitHub 토큰으로 레포 `_inbox/`에 커밋한다.
// 커밋되면 skin-deploy.yml 워크플로우가 평소처럼 자동 처리한다.
//
// 왜 Worker인가: 빌더는 공개 GitHub Pages(정적)라 토큰을 둘 수 없다.
// 토큰을 브라우저에 노출하지 않으려고 쓰기 권한을 이 서버가 대신 갖는다.
//
// 필요한 시크릿(= wrangler secret put 으로 설정):
//   GITHUB_TOKEN  : 이 레포 contents:write 권한이 있는 fine-grained PAT
//   ACCESS_KEY    : 디자이너가 빌더에 1회 입력하는 접근 비번(아무 문자열)
//
// 선택 변수(wrangler.toml [vars] — 비밀 아님):
//   OWNER, REPO, BRANCH, ALLOW_ORIGIN

const DEFAULTS = {
  OWNER: "shenika27",
  REPO: "daintyz_timer_characterList",
  BRANCH: "main",
  // 빌더가 올라간 GitHub Pages 오리진. 다른 곳에서의 호출은 CORS로 막힌다.
  ALLOW_ORIGIN: "https://shenika27.github.io",
};

function cfg(env, name) {
  return (env && env[name]) || DEFAULTS[name];
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": cfg(env, "ALLOW_ORIGIN"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

// 타이밍 공격에 덜 민감한 문자열 비교(길이 다르면 즉시 false).
function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// _inbox 안의 안전한 파일 경로만 허용(경로 탈출·상위 폴더 금지).
// 허용 예: _inbox/foo.zip, _inbox/foo.delete.json, _inbox/foo.skin-gift-codes.json
function isSafeInboxPath(p) {
  if (typeof p !== "string") return false;
  if (!p.startsWith("_inbox/")) return false;
  if (p.includes("..") || p.includes("//")) return false;
  const name = p.slice("_inbox/".length);
  // 하위 폴더 없이 파일 하나만. 파일명은 영문/숫자/._- 만.
  return /^[A-Za-z0-9._-]+$/.test(name);
}

async function gh(env, method, path, body) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "daintyz-inbox-worker",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "POST only" }, 405, env);
    }
    if (!env.GITHUB_TOKEN || !env.ACCESS_KEY) {
      return json({ ok: false, error: "서버 설정 미완료(시크릿 없음)" }, 500, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "JSON 파싱 실패" }, 400, env);
    }

    // 1) 접근 비번 확인
    if (!safeEqual(payload.key, env.ACCESS_KEY)) {
      return json({ ok: false, error: "접근 비번이 올바르지 않습니다." }, 401, env);
    }

    // 2) 경로/내용 검증
    const path = payload.path;
    if (!isSafeInboxPath(path)) {
      return json({ ok: false, error: `허용되지 않은 경로: ${path}` }, 400, env);
    }
    if (typeof payload.contentBase64 !== "string" || !payload.contentBase64) {
      return json({ ok: false, error: "contentBase64 누락" }, 400, env);
    }

    const OWNER = cfg(env, "OWNER");
    const REPO = cfg(env, "REPO");
    const BRANCH = cfg(env, "BRANCH");
    const apiPath = `/repos/${OWNER}/${REPO}/contents/${path}`;
    const message =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : `chore(skin): _inbox/${path.slice("_inbox/".length)} (빌더 업로드)`;

    // 3) 같은 경로 파일이 이미 있으면(대기 중 재업로드) sha가 있어야 덮어쓸 수 있다.
    let sha;
    const getRes = await gh(env, "GET", `${apiPath}?ref=${encodeURIComponent(BRANCH)}`);
    if (getRes.status === 200) {
      const info = await getRes.json();
      sha = info.sha;
    } else if (getRes.status !== 404) {
      const t = await getRes.text();
      return json({ ok: false, error: `기존 파일 조회 실패(${getRes.status})`, detail: t }, 502, env);
    }

    // 4) 커밋(PUT)
    const putRes = await gh(env, "PUT", apiPath, {
      message,
      content: payload.contentBase64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    });

    if (putRes.status === 200 || putRes.status === 201) {
      const out = await putRes.json();
      return json(
        {
          ok: true,
          path,
          commit: out.commit && out.commit.sha,
          htmlUrl: out.content && out.content.html_url,
        },
        200,
        env
      );
    }

    const errText = await putRes.text();
    return json(
      { ok: false, error: `GitHub 커밋 실패(${putRes.status})`, detail: errText },
      502,
      env
    );
  },
};
