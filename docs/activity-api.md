# 활동 조회 API (D1 데모)

현재 범위는 `GET /api/activities?scope=today`뿐입니다. 인증 없이 서버 내부
`DEMO_USER_ID = "me"`를 사용합니다. 사용자 ID 쿼리로 다른 사용자를 조회할 수 없습니다.
프론트엔드는 아직 mock state를 사용합니다. Channel Function 서명 검증은 유지합니다.

## 로컬 실행

저장소 루트에서 실행합니다. 원격 DB에는 적용하지 않습니다.

```sh
pnpm db:migrate:local
pnpm exec wrangler d1 execute DB --local --file=cloudflare/seed.sql
pnpm build:cloudflare
```

기존 `.dev.vars`가 있으면 덮어쓰지 마세요. 없는 경우 로컬 테스트용으로 생성합니다.
Channel 서버 초기화에는 기존과 같이 아래 값이 필요합니다. 가짜 값으로 실제 Channel 호출은 불가능합니다.

```dotenv
APP_ID=local-smoke
APP_SECRET=local-smoke-secret
SIGNING_KEY=1111111111111111111111111111111111111111111111111111111111111111
```

```sh
pnpm exec wrangler dev --local --port 8797
```

다른 터미널:

```sh
curl 'http://127.0.0.1:8797/api/activities?scope=today&date=2026-09-19'
curl 'http://127.0.0.1:8797/api/activities?scope=today'
curl -i 'http://127.0.0.1:8797/api/activities?scope=today&date=2026-02-30'
pnpm test:cloudflare
```

- 고정 seed 날짜는 **2026-09-19(한국 시간)**입니다. 수업 3개·활동 6개를 반환합니다.
- `date` 생략 시 한국 시간의 오늘을 사용합니다. 해당 날짜 데이터가 없으면 빈 목록일 수 있습니다.
- 당일 수업과 연결된 활동 및 각 수업의 다음 활동 회차를 반환합니다. 완료 활동은 제외합니다.
- `count`, `joined`는 참여 테이블에서 계산합니다. `time`, `session`은 기존 UI 호환 필드입니다.
- 응답: `{ classes: [{ id, name, start, end, room }], activities: [{ id, classId, title, place, classStartsAt, startsAt, endsAt, maxPeople, status, count, joined, time, session, prioritySuggested }] }`
- `prioritySuggested`는 이번 단계에서 `false`입니다. 재매칭 판별·개인별 참가자/선택 조회는 아직 구현하지 않았습니다.
- 잘못된 날짜·`scope`는 400입니다. `scope=mine`은 아직 지원하지 않습니다.
- seed는 별도 명령으로만 적용하며, 같은 ID의 기존 데이터는 덮어쓰지 않습니다.
- `0001_initial.sql`은 변경하지 않습니다. 신규 스키마는 `0002_activity_flow.sql`입니다.
- 정원 동시성·상태 전환·완료 후 선택 제한은 추후 쓰기 API에서 원자적으로 구현해야 합니다.
- 원격 마이그레이션은 기존 운영진 절차를 따릅니다. seed를 운영 DB에 자동 적용하지 않습니다.
