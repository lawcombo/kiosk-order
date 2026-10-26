# GitHub 작성 이력 설정

화면은 기존 단일 `index.html`을 유지합니다. 저장 버튼은 GitHub `lawcombo/kiosk-order` 저장소의 `main` 브랜치 루트에 있는 **`history.json` 파일 하나**에 신청 이력을 누적합니다. 파일은 첫 저장 때 자동으로 생깁니다. 작성 중 임시 저장과 달리, 이력은 브라우저 데이터를 지워도 남습니다.

## 처음에 필요한 것

1. [Cloudflare 계정 만들기](https://dash.cloudflare.com/sign-up). Workers **Free** 플랜을 사용합니다. 별도 도메인, DB, KV, R2 등 유료 자원은 사용하지 않습니다.
2. [GitHub fine-grained 토큰 만들기](https://github.com/settings/personal-access-tokens/new). Repository access에서 **Only select repositories → lawcombo/kiosk-order**를 선택하고, Repository permissions의 **Contents → Read and write**만 부여합니다. 만료일은 운영에 맞게 선택합니다.

토큰을 채팅, `index.html`, GitHub 파일에 붙여넣지 않습니다. 아래 Cloudflare **Secret**에만 입력합니다. 토큰 만료·취소 시 갱신은 필요하지만 매번 저장할 때 사용자가 인증할 필요는 없습니다.

## Cloudflare 웹 화면으로 배포 — 처음 한 번

1. Workers & Pages에서 `kiosk-order-history` Worker를 생성하고 **Edit code**로 들어갑니다.
2. 로컬 `history-api/worker.mjs` 파일 전체를 복사해서 화면의 `worker.js` 내용을 전부 교체한 뒤 **Deploy**를 누릅니다. 이 파일은 라이브러리 설치나 다른 파일 없이 그대로 동작합니다.
3. Worker 관리 화면의 **Settings → Variables and Secrets → Add → Secret**에서 이름을 `GITHUB_TOKEN`으로 입력하고 위에서 만든 GitHub 토큰을 값으로 넣습니다. 저장·배포까지 완료합니다.
4. API 코드에는 기본 저장소와 허용 주소가 들어 있어 별도 변수 입력이 필요 없습니다. 저장소나 페이지 주소를 변경할 때만 아래 설정을 추가합니다.

현재 생성한 Worker 주소는 `https://kiosk-order-history.jsh-eff.workers.dev`입니다. 기본 예제 배포만으로 이력 기능이 연결되지는 않으며 API 코드와 Secret 등록이 모두 필요합니다.

## CLI로 배포하는 경우

이 프로젝트 폴더에서 Node.js 22 이상으로 실행합니다.

```powershell
npx wrangler@4 login
npm run deploy:history
npx wrangler@4 secret put GITHUB_TOKEN --config history-api/wrangler.toml
```

- 첫 명령은 Cloudflare 로그인과 배포 권한 승인을 위한 브라우저를 엽니다.
- 두 번째 명령은 API 코드만 배포합니다. 아직 토큰이 없으면 저장 기능은 연결 준비 중으로 표시됩니다.
- 세 번째 명령의 비밀 입력 프롬프트에 GitHub 토큰을 넣습니다.
- 별도 npm 라이브러리 설치는 필요 없습니다. 위 명령의 Wrangler 도구만 실행 시 내려받습니다.

배포 결과의 Worker URL 뒤에 `/api/history`를 붙여 `index.html`의 다음 설정을 채웁니다. 현재 소스에는 아래 실제 주소를 반영했습니다. URL은 공개 설정이며 비밀 값이 아닙니다.

```html
<meta name="history-api" content="https://kiosk-order-history.jsh-eff.workers.dev/api/history">
```

이 설정이 포함된 `index.html`을 기존 페이지에 배포하면 연결됩니다. 다른 Worker를 생성하면 Cloudflare가 반환한 실제 URL로 변경해야 합니다.

페이지의 접속 도메인이 `https://lawcombo.github.io`와 다르면 `history-api/wrangler.toml`의 `ALLOWED_ORIGINS`에 실제 **도메인만** 추가하고 API를 다시 배포합니다. GitHub Pages 경로 `/kiosk-order/`는 origin에 포함하지 않습니다. 기본값에는 로컬 `4173` 포트도 포함되어 있습니다.

## 사용 방식

- **저장**: 현재 입력값·모델·옵션 수량·당시 부품명/P/N/단가를 `history.json`의 `entries` 배열에 새 항목으로 추가합니다. 기존 건은 유지합니다. 저장 완료가 표시된 건만 GitHub에 보관된 이력입니다.
- **이력보기**: 저장 일시(한국 시간)·현장명·유형/모델을 최신순으로 20개씩 조회합니다.
- **불러오기**: 현재 작성 내용을 바꾼다는 확인 후 해당 신청서를 복원합니다. 기존 신청일·설치 희망 시간과 단가 공개 여부도 복원합니다.
- 브라우저 임시 데이터 삭제나 다른 PC 접속 후에도 같은 API에 연결하면 GitHub 이력이 조회됩니다.
- `history.json`을 삭제하면 전체 이력이 목록에서 빠집니다. 화면에는 삭제 기능을 두지 않았습니다.

## 접근 범위

현재 요청한 구성은 별도 사용자 로그인 없이 허용된 페이지에서 저장·조회하는 방식입니다. CORS는 브라우저의 다른 도메인 접근을 제한하지만 사용자 인증을 대신하지는 않습니다. API는 지정 저장소의 `history.json` 누적 저장과 조회만 제공하며, 다른 파일 수정·삭제·경로 선택 기능은 없습니다. 공개 저장소의 이력 파일은 공개됩니다.

## 로컬 실행과 검증

```powershell
npm test
npm run dev
```

`npm test`는 메모리로 GitHub 응답을 모의 처리하므로 실제 저장소에 시험 파일을 올리지 않습니다. 로컬 서버는 `127.0.0.1:4173`에서 페이지와 API 경로만 제공합니다. 기본적으로 페이지는 설정된 Cloudflare API에 연결하며, `GITHUB_TOKEN` 환경 변수가 있으면 로컬 API로 연결합니다. `.git`, 비밀 설정 파일, 기타 저장소 파일을 웹으로 제공하지 않습니다.

로컬에서 실제 GitHub 저장까지 시험하려면 `GITHUB_TOKEN`을 현재 터미널의 환경 변수로 안전하게 설정한 뒤 로컬 서버를 실행합니다. 개발 도구에 입력한 토큰이 명령 기록에 남지 않도록 주의하며, 가능하면 배포된 Worker와 연결해 확인하는 방식을 사용합니다. 기존에 `4173` 서버가 실행 중이면 종료하거나 `PORT`를 바꿉니다.

## 운영 한도

Workers Free는 요청 수와 CPU 시간 한도가 있으며, GitHub에도 API 사용량 제한이 있습니다. 이 구현은 저장·조회에 GitHub Contents API를 사용합니다. 기존 파일의 SHA를 확인해 업데이트하고, 다른 사용자가 먼저 저장해 충돌하면 최신 파일을 다시 읽어 최대 3회 시도합니다. 충돌이 계속되면 성공으로 표시하지 않고 재시도를 안내합니다.

단일 파일 방식이므로 누적 이력이 많아질수록 읽고 쓰는 양이 늘어납니다. GitHub Contents API의 Base64 응답 범위 안에서 동작하도록 파일 용량을 900 KiB로 제한하며, 한도에 도달하면 기존 이력을 삭제하지 않고 새 저장을 중단해 알립니다. 보관 건수는 신청 내용 길이에 따라 달라집니다. 파일을 백업·정리하거나 저장 구조를 확장해야 계속 저장할 수 있습니다. 저장 때 `[skip ci]` 커밋 메시지를 사용하지만, GitHub Pages의 자동 배포 동작은 저장소 설정에 따라 달라질 수 있습니다.

공식 문서: [Workers 무료 한도](https://developers.cloudflare.com/workers/platform/limits/), [Secret 등록](https://developers.cloudflare.com/workers/configuration/secrets/), [GitHub Contents API](https://docs.github.com/en/rest/repos/contents).
