# FlowFit Runner Deployment

이 폴더는 FlowFit Runner 서버를 배포하고 운영하기 위한 파일만 둔다.

배포 계층의 역할:

- 운영 환경 변수 예시 제공
- 서버 시작 전 점검
- build, migration, smoke test 절차 안내
- 운영자가 실수로 비밀값을 패키지에 넣지 않도록 체크

배포 계층이 하지 않는 것:

- 업무 판단
- 승인 정책 변경
- connector capability 분류
- 자동 실행 우회
- `.env` 또는 API key 번들링

## Windows에서 배포 zip 만들기

Windows 개발 PC에서는 실데이터와 OS별 설치물을 제외한 Runner 서버 zip만 만든다.

```powershell
cd flowfit-runner
npm run deploy:check
npm run deploy:pack
```

`deploy:pack`은 워크스페이스의 `.flowfit-exports`에 `flowfit-runner-deploy-YYYYMMDD-HHMM.zip`을 만든다.

바탕화면에 바로 만들고 싶으면 다음을 사용한다.

```powershell
npm run deploy:pack:desktop
```

제외되는 항목:

- `node_modules`
- `dist`
- `.npm-cache`
- `.flowfit`
- `.env`, `.env.local`
- `*.log`, `runner*.log`

Windows의 `node_modules`는 macOS에서 재사용하지 않는다. Mac mini에서 `npm ci`를 새로 실행한다.

## Mac mini 서버 실행 순서

```bash
cd flowfit-runner
npm ci
npm run deploy:init-env:mac
npm run build
npm run db:migrate
npm run test:offline-demotion
npm run test:approval-resume
npm run deploy:check:mac
npm run start
```

## Mac mini에서 세션 암호화 키 생성

세션 암호화 키는 서버 로컬 비밀이다. Windows PC에서 채워서 옮기지 말고 Mac mini에서 새로 만든다.

권장 방식은 아래 초기화 스크립트다.

```bash
npm run deploy:init-env:mac
```

이 스크립트는 `.env`를 만들고 다음 값을 자동 생성한다.

- `RUNNER_API_KEYS`
- `SESSION_ENCRYPTION_KEY_BASE64`
- `SESSION_ENCRYPTION_KEY_ID`
- `DEVICE_COMMAND_SECRET`
- `DEVICE_TOKEN_PEPPER`
- `COMPANY_TOKEN_PEPPER`

수동 생성이 필요하면 다음 명령을 쓴다.

```bash
echo "SESSION_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> .env
echo "SESSION_ENCRYPTION_KEY_ID=key-$(date +%Y%m%d)" >> .env
```

이 명령은 값을 화면에 출력하지 않고 `.env`에 바로 추가한다.

## 최소 필수 환경 변수

- `DATABASE_URL`
- `PORT`
- `STUDIO_ORIGIN`
- `RUNNER_API_KEYS`
- `SESSION_ENCRYPTION_KEY_BASE64`
- `SESSION_ENCRYPTION_KEY_ID`

AI 기능을 실제로 쓰려면 아래 중 하나 이상이 필요하다.

- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `ANTHROPIC_API_KEY`

## 배포 전 확인

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\check-server.ps1
```

macOS/Linux:

```bash
bash deploy/check-server.sh
```

이 스크립트는 Node/npm, package 파일, `.env` 존재 여부, 핵심 환경 변수 이름을 점검한다. 실제 비밀값은 출력하지 않는다.

## 관리자 설치/점검 상세 가이드

서버에 zip을 올린 뒤 관리자가 따라야 하는 상세 절차는 `deploy/ADMIN_INSTALL_CHECK_GUIDE.md`를 기준으로 한다.

이 문서는 다음을 포함한다.

- Mac mini 설치 순서
- `.env` 작성과 세션 암호화 키 생성
- build, migration, 테스트 순서
- Bearer 인증 기반 smoke test
- Studio/UI 연결 확인
- 장애 대응과 롤백 기준

## 산출물 제외 기준

배포 zip에서 제외:

- `node_modules`
- `dist`
- `.env`
- `.flowfit`
- `*.log`
- `runner*.log`
- `.npm-cache`

서버 소스와 `deploy/**`는 포함해도 되지만, 운영 비밀값은 항상 현장에서 직접 입력한다.
