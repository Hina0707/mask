"use strict";

// 별도 패키지 없이 정적 화면과 Vercel 함수를 함께 실행하는 로컬 서버입니다.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const dustHandler = require("./api/dust.js");
const port = Number(process.env.PORT || 3000);

// 허용한 화면 파일만 제공하므로 환경변수 파일과 서버 코드는 공개하지 않습니다.
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]]
]);

const server = http.createServer(async (req, res) => {
  // Vercel의 응답 도우미를 제공해 배포할 함수를 그대로 재사용합니다.
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };

  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/dust") {
      req.query = Object.create(null);
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        req.query[key] = values.length === 1 ? values[0] : values;
      }
      await dustHandler(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json({ message: "조회 요청만 사용할 수 있습니다." });
      return;
    }
    const file = files.get(url.pathname);
    if (!file) {
      res.status(404).json({ message: "요청한 페이지가 없습니다." });
      return;
    }
    const body = await fs.readFile(path.join(__dirname, file[0]));
    res.setHeader("Content-Type", file[1]);
    res.setHeader("Cache-Control", "no-store");
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ message: "로컬 서버에서 요청을 처리하지 못했습니다." });
    } else {
      res.end();
    }
  }
});

// 내 컴퓨터에서만 접속하도록 루프백 주소에서 실행합니다.
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? "이미 사용 중인 포트입니다." : "서버를 실행하지 못했습니다.");
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`로컬 서버 실행 중: http://localhost:${port}`);
});
