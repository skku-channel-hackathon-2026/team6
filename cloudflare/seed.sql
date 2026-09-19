-- 발표용 로컬 데모 데이터
-- 기준 날짜: 2026-09-19 (토) / GET /api/activities?scope=today&date=2026-09-19
-- 로컬 데모 재실행 시 이 파일이 만든 이전 활동을 먼저 정리합니다.

DELETE FROM rematch_preferences
WHERE activity_id IN ('coffee', 'walk', 'lunch', 'english-walk', 'tea', 'next-english-coffee', 'previous-english-coffee');
DELETE FROM activity_participants
WHERE activity_id IN ('coffee', 'walk', 'lunch', 'english-walk', 'tea', 'next-english-coffee', 'previous-english-coffee');
DELETE FROM activities
WHERE id IN ('coffee', 'walk', 'lunch', 'english-walk', 'tea', 'next-english-coffee', 'previous-english-coffee');
DELETE FROM enrollments
WHERE user_id IN ('junho', 'sujin', 'yuna');
DELETE FROM users
WHERE id IN ('junho', 'sujin', 'yuna');
INSERT INTO users (id, name, department, student_number) VALUES
  ('me', '나', '소프트웨어학과', '2026310001'),
  ('jiyun', '지윤', '소프트웨어학과', '2026310002'),
  ('minseo', '민서', '소프트웨어학과', '2026310003')
ON CONFLICT(id) DO NOTHING;

INSERT INTO classes (id, name, term, section, weekday, start_time, end_time, room) VALUES
  ('writing', '글쓰기 기초', '2026-2', '01', 6, '09:00', '10:15', '인문관 201호'),
  ('coding', '컴퓨팅 사고', '2026-2', '01', 6, '11:00', '12:15', '정보관 302호'),
  ('english', '대학 영어', '2026-2', '01', 6, '14:00', '15:15', '인문관 104호')
ON CONFLICT(id) DO NOTHING;

INSERT INTO enrollments (user_id, class_id)
SELECT users.id, classes.id FROM users CROSS JOIN classes
WHERE users.id IN ('me', 'jiyun', 'minseo')
  AND classes.id IN ('writing', 'coding', 'english')
ON CONFLICT(user_id, class_id) DO NOTHING;

-- 오늘: 모집 중 2개와 확정 1개가 한눈에 보입니다.
-- 약속: me가 참여한 모집 중·확정·완료 약속을 함께 보여줍니다.
INSERT INTO activities (
  id, class_id, class_starts_at, starts_at, ends_at,
  title, place, max_people, status, completed_at
) VALUES
  ('coffee', 'writing', '2026-09-19T00:00:00Z', '2026-09-18T23:30:00Z', '2026-09-18T23:50:00Z', '수업 전 커피', '정문 카페 앞', 2, 'recruiting', NULL),
  ('lunch', 'coding', '2026-09-19T02:00:00Z', '2026-09-19T03:20:00Z', '2026-09-19T04:00:00Z', '수업 후 같이 밥', '학생식당 입구', 4, 'recruiting', NULL),
  ('english-walk', 'english', '2026-09-19T05:00:00Z', '2026-09-19T04:50:00Z', '2026-09-19T05:00:00Z', '같이 강의실 가기', '인문관 1층 로비', 2, 'confirmed', NULL),
  ('previous-english-coffee', 'english', '2026-09-12T05:00:00Z', '2026-09-12T04:20:00Z', '2026-09-12T04:50:00Z', '수업 전 커피', '정문 카페 앞', 2, 'completed', '2026-09-12T06:00:00Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO activity_participants (activity_id, user_id) VALUES
  ('coffee', 'jiyun'), ('lunch', 'me'),
  ('english-walk', 'me'), ('english-walk', 'minseo'),
  ('previous-english-coffee', 'me'), ('previous-english-coffee', 'jiyun')
ON CONFLICT(activity_id, user_id) DO NOTHING;
