# GitHub 작성 이력 설정

화면은 기존 단일 `index.html`을 유지합니다. 저장 버튼은 GitHub `lawcombo/kiosk-order` 저장소의 `main` 브랜치 루트에 있는 **`history.json` 파일 하나**에 신청 이력을 누적합니다. 파일은 첫 저장 때 자동으로 생기며, 이력은 브라우저 데이터를 지워도 남습니다. 브라우저 자동 저장은 사용하지 않습니다. 입력한 내용은 저장 버튼을 눌러 보관하며, 새로고침하면 새 신청서로 시작합니다.

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

### 삭제·페이징 기능으로 업데이트하기

이전에 Worker를 배포했다면 **Edit code에서 최신 버전(Latest)을 선택**한 뒤, 수정된 `history-api/worker.mjs` 전체를 `worker.js`에 붙여넣고 다시 **Deploy**합니다. 기존 `GITHUB_TOKEN` Secret은 유지합니다. `index.html`만 GitHub에 푸시해도 Cloudflare Worker는 자동 업데이트되지 않습니다.

Worker 업데이트 전에도 새 화면은 이전 목록 API를 읽어 10건씩 나눠 표시합니다. 다만 삭제 버튼은 새 API 연결이 확인될 때까지 비활성화됩니다.

### 부품·모델 구성 관리로 업데이트하기

같은 Worker의 코드를 다시 갱신해야 합니다. 기존 `GITHUB_TOKEN` Secret과 저장소 권한은 그대로 사용합니다. 추가 Secret이나 DB는 필요 없습니다. 새 API는 **`GET /api/catalog`**, **`PUT /api/catalog`**를 제공하며, 저장소 루트의 `parts.json`을 읽고 씁니다.

`parts.json`은 부품 73개, 모델 8개, 추가 옵션 23개로 시작합니다. 기존의 일반형·슬림형 구성, 수량, 단가, NICE/KIS VAN 조건과 여권인식기 교체 기준을 그대로 옮겼습니다. 페이지 안에도 이 최초 구성을 포함하므로 API 업데이트 전에도 기본 주문 화면을 사용할 수 있습니다. 관리 화면 저장은 새 API 연결 후에 가능합니다.

관리 화면은 다음 순서로 사용합니다.

1. **부품 목록**: 구분·품목명·P/N·단가를 편집하거나 행을 추가합니다. 빈 P/N은 `-`, 빈 단가는 미확정, 0은 확정된 0원입니다. 사용 중인 부품을 제거하면 어떤 모델·옵션에서 사용 중인지 확인하고, 해당 연결도 함께 제거합니다.
2. **모델 구성**: G1~G4/S1~S4를 선택하고 부품을 배치합니다. 수량, 고정/모델 추가/장착 부속, 항상 포함/NICE만/KIS만을 설정합니다. 다른 모델의 구성을 복사하거나 여권인식기 교체 시 차감할 기본 부품도 지정할 수 있습니다. 부품의 구분은 관리용 분류이며, 모델에 포함할 품목은 이 화면에서 직접 선택합니다.
3. **추가 옵션**: 메인 화면에서 수량을 선택할 품목을 등록합니다. 표시 이름·그룹·단위와 기본 여권인식기 교체 여부를 편집합니다.
4. **변경사항 저장**: 전체 설정을 `parts.json`에 덮어씁니다. 성공하면 메인 구성·원가·복사·인쇄·모델/옵션 보고서에 함께 적용됩니다. 저장 전 변경은 현재 주문 화면에 적용하지 않습니다. 저장 실패 시 편집 내용을 유지합니다.

모달을 열거나 페이지에 접속할 때 저장된 설정을 다시 조회합니다. 다른 사용자가 먼저 설정을 변경했다면 저장을 거부하고 다시 불러오도록 안내해, 오래된 편집본으로 덮어쓰지 않습니다. 저장하지 않고 닫을 때는 확인합니다.

새로 저장하는 신청 이력에는 당시 부품·모델·옵션 설정도 함께 보관합니다. 예전 형식의 이력은 최초 모델 구성을 기준으로 당시 단가/P/N을 복원합니다. 따라서 이후 부품을 제거하거나 모델을 바꿔도 과거 신청서 구성을 유지합니다. **새 신청서 작성**은 최신 공유 설정으로 시작합니다.

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

- **이력 저장**: 현재 입력값·모델·옵션 수량·당시 부품명/P/N/단가와 모델 설정을 `history.json`의 `entries` 배열에 새 항목으로 추가합니다. 기존 건은 유지합니다. 저장 완료가 표시된 건만 GitHub에 보관된 이력입니다. 부품 관리의 **변경사항 저장**과 별개입니다.
- **이력보기**: 저장 일시(한국 시간)·현장명·유형/모델을 최신순으로 한 페이지에 10개씩 조회합니다. 전체 건수, 현재 범위, 페이지 번호, 이전·다음 버튼을 표시합니다.
- **불러오기**: 현재 작성 내용을 바꾼다는 확인 후 해당 신청서를 복원합니다. 기존 신청일·설치 희망 시간과 단가 공개 여부도 복원합니다.
- **삭제**: 목록의 해당 항목에서 삭제를 누르고 확인하면 그 고유 ID 한 건만 `history.json`에서 제거합니다. 나머지 항목은 유지하며, 마지막 항목을 삭제해도 파일은 빈 목록으로 남습니다. 현재 입력 중인 신청서는 바꾸지 않습니다. 공유 이력이므로 다른 사용자의 목록에도 반영됩니다. GitHub 커밋 기록에 이전 파일 내용이 남을 수 있습니다.
- 브라우저 데이터 삭제나 다른 PC 접속 후에도 같은 API에 연결하면 GitHub 이력이 조회됩니다.
- 입력값·옵션·부품 단가 변경을 브라우저에 자동 저장하거나 이전 캐시에서 복원하지 않습니다. 저장된 이력을 불러오거나 명시적으로 신청서 파일을 가져올 때만 기존 입력 내용을 복원합니다.

## 접근 범위

현재 요청한 구성은 별도 사용자 로그인 없이 허용된 페이지에서 이력과 공유 부품 설정을 관리하는 방식입니다. CORS는 브라우저의 다른 도메인 접근을 제한하지만 사용자 인증을 대신하지는 않습니다. API는 지정 저장소의 `history.json` 조회·누적 저장·선택한 ID 한 건 제거와 `parts.json` 조회·교체만 제공합니다. 임의 파일 수정·파일 자체 삭제·경로 선택 기능은 없습니다. 공개 저장소의 파일은 공개됩니다.

## 로컬 실행과 검증

```powershell
npm test
npm run dev
```

`npm test`는 메모리로 GitHub 응답을 모의 처리하므로 실제 저장소에 시험 파일을 올리지 않습니다. 로컬 서버는 `127.0.0.1:4173`에서 페이지와 API 경로만 제공합니다. 기본적으로 페이지는 설정된 Cloudflare API에 연결하며, `GITHUB_TOKEN` 환경 변수가 있으면 로컬 API로 연결합니다. `.git`, 비밀 설정 파일, 기타 저장소 파일을 웹으로 제공하지 않습니다.

선택적 브라우저 검증은 Playwright와 Edge가 있는 환경에서 `node tests/browser-catalog-check.mjs`로 실행합니다. `PLAYWRIGHT_MODULE`에 설치된 Playwright 모듈 경로를 지정할 수 있습니다. 실제 GitHub 대신 메모리 저장소를 사용해 부품 추가·모델 배치·저장 실패·복사/인쇄/보고서·과거 이력·모바일 배치를 검증합니다.

관리 코드 원본은 `scripts/catalog-ui.js`이며 `index.html`의 `catalogCode`에 포함됩니다. API와 브라우저 검증 함수도 동일한 코드를 사용합니다. 원본을 수정한 후 `node scripts/embed-catalog.mjs --patch`가 출력하는 패치를 적용하면 동기화됩니다. `npm test`는 포함된 코드가 원본과 일치하는지도 확인합니다.

로컬에서 실제 GitHub 저장까지 시험하려면 `GITHUB_TOKEN`을 현재 터미널의 환경 변수로 안전하게 설정한 뒤 로컬 서버를 실행합니다. 개발 도구에 입력한 토큰이 명령 기록에 남지 않도록 주의하며, 가능하면 배포된 Worker와 연결해 확인하는 방식을 사용합니다. 기존에 `4173` 서버가 실행 중이면 종료하거나 `PORT`를 바꿉니다.

## 운영 한도

Workers Free는 요청 수와 CPU 시간 한도가 있으며, GitHub에도 API 사용량 제한이 있습니다. 이 구현은 저장·조회·개별 항목 삭제에 GitHub Contents API를 사용합니다. 저장·삭제 모두 기존 파일의 SHA를 확인해 업데이트하고, 다른 사용자의 변경으로 충돌하면 최신 파일을 다시 읽어 최대 3회 시도합니다. 충돌이 계속되면 성공으로 표시하지 않고 재시도를 안내합니다.

단일 파일 방식이므로 누적 이력이 많아질수록 읽고 쓰는 양이 늘어납니다. GitHub Contents API의 Base64 응답 범위 안에서 동작하도록 파일 용량을 900 KiB로 제한하며, 한도에 도달하면 기존 이력을 삭제하지 않고 새 저장을 중단해 알립니다. 보관 건수는 신청 내용 길이에 따라 달라집니다. 파일을 백업·정리하거나 저장 구조를 확장해야 계속 저장할 수 있습니다. 저장 때 `[skip ci]` 커밋 메시지를 사용하지만, GitHub Pages의 자동 배포 동작은 저장소 설정에 따라 달라질 수 있습니다.

공식 문서: [Workers 무료 한도](https://developers.cloudflare.com/workers/platform/limits/), [Secret 등록](https://developers.cloudflare.com/workers/configuration/secrets/), [GitHub Contents API](https://docs.github.com/en/rest/repos/contents).
