import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useCallFunction } from '@channel.io/app-sdk-wam'
import { TUTORIAL_FUNCTIONS, type SendAsBotInput } from '@tutorial/shared'
import { useTutorialWamData } from './hooks/useTutorialWamData'
import { useWamClose } from '@channel.io/app-sdk-wam'

type Tab = '오늘' | '약속' | '마이'
type Activity = {
  id: string
  classId: string
  title: string
  time: string
  place: string
  count: number
  maxPeople: number
  joined: boolean
  status: 'recruiting' | 'confirmed' | 'completed'
  session: number
  participantIds: string[]
  participants?: { id: string; name: string }[]
  mySelectedUserIds?: string[]
  prioritySuggested?: boolean
  className?: string
  createdBy?: boolean
}
const currentUserId = 'me'
const tabs: Tab[] = ['오늘', '약속', '마이']
type ClassInfo = {
  id: string
  name: string
  start: string
  end: string
  room: string
}
type ActivitiesResponse = {
  classes: ClassInfo[]
  activities: (Omit<Activity, 'participantIds'> & {
    participantIds?: string[]
  })[]
}

function App() {
  const { close } = useWamClose()
  const { data: wamData } = useTutorialWamData()

  const { call: sendAsBot } = useCallFunction<void>({
    appId: wamData?.appId ?? '',
    name: TUTORIAL_FUNCTIONS.sendAsBot,
  })

  async function sendChannelBotMessage(plainText: string) {
    if (!wamData || wamData.chatType !== 'group' || !wamData.targetToken) {
      return
    }

    const input: SendAsBotInput = {
      targetToken: wamData.targetToken,
      broadcast: wamData.broadcast,
      rootMessageId: wamData.rootMessageId,
      plainText,
    }

    try {
      await sendAsBot(input)
    } catch {
      // 봇 메시지 실패 때문에 기존 서비스 기능까지 실패시키지 않는다.
    }
  }
  const [tab, setTab] = useState<Tab>('오늘')
  const [classes, setClasses] = useState<ClassInfo[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const participationRequests = useRef(new Set<string>())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const preferenceRequests = useRef(new Set<string>())
  const todayActivityIds = useRef(new Set<string>())
  const [participantNames, setParticipantNames] = useState<
    Record<string, string>
  >({})
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ClassInfo[]>([])
  const [notice, setNotice] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    classId: '',
    title: '',
    place: '',
    startTime: '',
    endTime: '',
    maxPeople: 2,
  })
  useEffect(() => {
    const controller = new AbortController()
    async function loadActivities() {
      try {
        const [response, mineResponse] = await Promise.all([
          fetch('/api/activities?scope=today', { signal: controller.signal }),
          fetch('/api/activities?scope=mine', { signal: controller.signal }),
        ])
        if (!response.ok || !mineResponse.ok)
          throw new Error('Failed to load activities')
        const data: ActivitiesResponse = await response.json()
        const mine: ActivitiesResponse = await mineResponse.json()
        if (
          !Array.isArray(data.classes) ||
          !Array.isArray(data.activities) ||
          !Array.isArray(mine.classes) ||
          !Array.isArray(mine.activities)
        )
          throw new Error('Invalid response')
        const merged = new Map(
          data.activities.map((activity) => [activity.id, activity])
        )
        mine.activities.forEach((activity) => merged.set(activity.id, activity))
        const loadedActivities = [...merged.values()].map((activity) => ({
          ...activity,
          className: mine.classes.find(
            (lesson) => lesson.id === activity.classId
          )?.name,
          participantIds:
            activity.participants?.map((participant) => participant.id) ?? [],
          mySelectedUserIds: activity.mySelectedUserIds ?? [],
          createdBy: Boolean(activity.createdBy),
        }))
        if (controller.signal.aborted) return
        todayActivityIds.current = new Set(
          data.activities.map((activity) => activity.id)
        )
        setParticipantNames(
          Object.fromEntries(
            mine.activities.flatMap((activity) =>
              (activity.participants ?? []).map((participant) => [
                participant.id,
                participant.name,
              ])
            )
          )
        )
        setClasses(data.classes)
        setDraft(data.classes)
        setCreateForm((current) => ({
          ...current,
          classId: current.classId || data.classes[0]?.id || '',
          startTime: current.startTime || data.classes[0]?.start || '',
          endTime: current.endTime || data.classes[0]?.end || '',
        }))
        setActivities(loadedActivities)
      } catch {
        if (!controller.signal.aborted) {
          setLoadError(
            '수업과 활동을 불러오지 못했어요. 잠시 후 새로고침해 주세요.'
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadActivities()
    return () => controller.abort()
  }, [])
  const date = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  async function toggleActivity(id: string) {
    const activity = activities.find((item) => item.id === id)
    if (
      !activity ||
      participationRequests.current.has(id) ||
      activity.status === 'completed' ||
      (!activity.joined &&
        (activity.status === 'confirmed' ||
          activity.count >= activity.maxPeople))
    )
      return
    participationRequests.current.add(id)
    try {
      const response = await fetch(
        `/api/activities/${encodeURIComponent(id)}/participation`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ joined: !activity.joined }),
        }
      )
      if (!response.ok) throw new Error('Participation failed')
      const data: {
        activity: Pick<
          Activity,
          'id' | 'joined' | 'count' | 'maxPeople' | 'status'
        >
      } = await response.json()
      const updated = data.activity
      if (
        !updated ||
        updated.id !== id ||
        typeof updated.joined !== 'boolean' ||
        !Number.isInteger(updated.count) ||
        !Number.isInteger(updated.maxPeople) ||
        updated.count < 0 ||
        updated.count > updated.maxPeople ||
        !['recruiting', 'confirmed', 'completed'].includes(updated.status)
      )
        throw new Error('Invalid participation response')
      setActivities((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...updated,
                participantIds: [
                  ...item.participantIds.filter(
                    (userId) => userId !== currentUserId
                  ),
                  ...(updated.joined ? [currentUserId] : []),
                ],
              }
            : item
        )
      )
      if (
        updated.joined &&
        updated.status === 'confirmed' &&
        activity.status !== 'confirmed'
      ) {
        void sendChannelBotMessage(
          [
            '약속이 확정됐어요',
            '',
            activity.className ?? '',
            activity.title,
            `${activity.time} · ${activity.place}`,
            `${updated.count}명이 함께해요.`,
          ]
            .filter(Boolean)
            .join('\n')
        )
      }
      setNotice(
        !updated.joined
          ? `${activity.title} 참여를 취소했어요.`
          : updated.status === 'confirmed'
            ? `${activity.title} 약속이 확정됐어요.`
            : `${activity.title}에 참여했어요. 다시 누르면 취소할 수 있어요.`
      )
    } catch {
      setNotice('참여 상태를 변경하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      participationRequests.current.delete(id)
    }
  }

  async function createNewActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      if (!response.ok) throw new Error('Create failed')
      const created: Activity = {
        ...(await response.json()),
        session: 0,
        participantIds: [currentUserId],
        createdBy: true,
      }
      todayActivityIds.current.add(created.id)
      setActivities((current) => [...current, created])
      setShowCreate(false)
      setCreateForm((current) => ({ ...current, title: '', place: '' }))
      void sendChannelBotMessage(
        [
          '새 약속이 열렸어요',
          '',
          created.className ??
            classes.find((lesson) => lesson.id === created.classId)?.name ??
            '',
          created.title,
          `${created.time} · ${created.place}`,
          `현재 ${created.count}/${created.maxPeople}명`,
        ]
          .filter(Boolean)
          .join('\n')
      )
      setNotice('약속을 만들었어요.')
    } catch {
      setNotice('약속을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
  }

  async function deleteCreatedActivity(id: string) {
    try {
      const response = await fetch(
        `/api/activities/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      )
      if (!response.ok) throw new Error('Delete failed')
      setActivities((current) =>
        current.filter((activity) => activity.id !== id)
      )
      todayActivityIds.current.delete(id)
      setNotice('약속을 삭제했어요.')
    } catch {
      setNotice(
        '약속을 삭제하지 못했어요. 참여자가 있거나 이미 확정된 약속일 수 있어요.'
      )
    }
  }

  async function completeActivity(id: string) {
    if (participationRequests.current.has(id)) return
    participationRequests.current.add(id)
    try {
      const response = await fetch(
        `/api/activities/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        }
      )
      if (!response.ok) throw new Error('Completion failed')
      const mineResponse = await fetch('/api/activities?scope=mine')
      if (!mineResponse.ok) throw new Error('Failed to load completed activity')
      const mine: ActivitiesResponse = await mineResponse.json()
      const completed = mine.activities.find((item) => item.id === id)
      if (!completed || completed.status !== 'completed')
        throw new Error('Invalid response')
      setActivities((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                ...completed,
                participantIds:
                  completed.participants?.map(
                    (participant) => participant.id
                  ) ?? [],
                mySelectedUserIds: completed.mySelectedUserIds ?? [],
              }
            : item
        )
      )
      setParticipantNames((current) => ({
        ...current,
        ...Object.fromEntries(
          (completed.participants ?? []).map((participant) => [
            participant.id,
            participant.name,
          ])
        ),
      }))
      setNotice('만남이 끝났어요. 다시 보고 싶은 사람을 골라보세요.')
    } catch {
      setNotice(
        '만남 완료 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'
      )
    } finally {
      participationRequests.current.delete(id)
    }
  }

  async function toggleFeedback(activity: Activity, participantId: string) {
    if (
      activity.status !== 'completed' ||
      !activity.joined ||
      participantId === currentUserId ||
      !activity.participantIds.includes(participantId) ||
      preferenceRequests.current.has(activity.id)
    )
      return
    preferenceRequests.current.add(activity.id)
    try {
      const response = await fetch(
        `/api/activities/${encodeURIComponent(activity.id)}/preferences/${encodeURIComponent(participantId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selected: !activity.mySelectedUserIds?.includes(participantId),
          }),
        }
      )
      if (!response.ok) throw new Error('Preference failed')
      const data: { activityId: string; mySelectedUserIds: string[] } =
        await response.json()
      if (
        data.activityId !== activity.id ||
        !Array.isArray(data.mySelectedUserIds) ||
        data.mySelectedUserIds.some(
          (id) =>
            typeof id !== 'string' ||
            id === currentUserId ||
            !activity.participantIds.includes(id)
        )
      )
        throw new Error('Invalid response')
      setActivities((current) =>
        current.map((item) =>
          item.id === activity.id
            ? { ...item, mySelectedUserIds: data.mySelectedUserIds }
            : item
        )
      )
      setNotice('선택했어요. 상대방에게는 보이지 않아요.')
    } catch {
      setNotice('저장하지 못했어요. 잠시 후 다시 해보세요.')
    } finally {
      preferenceRequests.current.delete(activity.id)
    }
  }

  function isPriorityActivity(activity: Activity) {
    return (
      activity.status === 'recruiting' &&
      !activity.joined &&
      (activity.prioritySuggested ?? false)
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="close-button"
          aria-label="닫기"
          onClick={close}
        >
          ×
        </button>
      </header>
      <main>
        <div className="page-heading">
          <h1>
            {tab === '오늘'
              ? '오늘 같이할 일'
              : tab === '약속'
                ? '내 약속'
                : tab}
          </h1>
          {tab === '오늘' && <span className="date">{date}</span>}
        </div>
        <p
          className="notice"
          role="status"
        >
          {loading ? '수업과 활동을 불러오는 중이에요.' : loadError || notice}
        </p>
        {tab === '오늘' && (
          <>
            <p className="page-description">
              같은 수업 친구들과 수업 전후를 같이 보내요.
            </p>
            <button
              type="button"
              className="secondary create-button"
              onClick={() => setShowCreate((current) => !current)}
            >
              {showCreate ? '약속 만들기 닫기' : '약속 만들기'}
            </button>
            {showCreate && (
              <form
                className="create-form"
                onSubmit={createNewActivity}
              >
                <label>
                  수업
                  <select
                    value={createForm.classId}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        classId: event.target.value,
                      }))
                    }
                  >
                    {classes.map((lesson) => (
                      <option
                        key={lesson.id}
                        value={lesson.id}
                      >
                        {lesson.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  무엇을 할까요?
                  <input
                    required
                    value={createForm.title}
                    placeholder="예: 수업 끝나고 밥 먹기"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  어디서 만날까요?
                  <input
                    required
                    value={createForm.place}
                    placeholder="예: 학생회관 앞"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        place: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="time-fields">
                  <label>
                    시작{' '}
                    <input
                      required
                      type="time"
                      value={createForm.startTime}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    종료{' '}
                    <input
                      required
                      type="time"
                      value={createForm.endTime}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          endTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label>
                  최대 인원
                  <select
                    value={createForm.maxPeople}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        maxPeople: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={2}>2명</option>
                    <option value={3}>3명</option>
                    <option value={4}>4명</option>
                  </select>
                </label>
                <button type="submit">약속 올리기</button>
              </form>
            )}
            {classes.map((lesson) => (
              <section
                className="class-section"
                key={lesson.id}
                aria-labelledby={`class-${lesson.id}`}
              >
                <div className="class-heading">
                  <h2 id={`class-${lesson.id}`}>{lesson.name}</h2>
                  <p className="muted">
                    {lesson.start}–{lesson.end} · {lesson.room}
                  </p>
                </div>
                <ul className="activity-list">
                  {activities
                    .filter(
                      (item) =>
                        item.classId === lesson.id &&
                        todayActivityIds.current.has(item.id) &&
                        item.status !== 'completed'
                    )
                    .sort(
                      (a, b) =>
                        Number(isPriorityActivity(b)) -
                        Number(isPriorityActivity(a))
                    )
                    .map((activity) => (
                      <li
                        className={`activity activity-option${activity.status === 'confirmed' && !activity.joined ? ' is-full' : ''}`}
                        key={activity.id}
                      >
                        <div>
                          {isPriorityActivity(activity) && (
                            <span className="badge">다시 함께하기</span>
                          )}
                          <p className="activity-title">{activity.title}</p>
                          {activity.session > 0 && (
                            <p className="muted">다음 수업에서</p>
                          )}
                          <p className="muted">
                            {activity.time} · {activity.place}
                          </p>
                          <p className="count">
                            {activity.count}/{activity.maxPeople}명 ·{' '}
                            {activity.status === 'confirmed'
                              ? '약속 확정'
                              : '모이는 중'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={activity.joined ? 'secondary' : undefined}
                          disabled={
                            !activity.joined && activity.status === 'confirmed'
                          }
                          aria-pressed={activity.joined}
                          aria-label={`${activity.title} ${activity.joined ? '참여 중, 누르면 참여 취소' : activity.status === 'confirmed' ? '약속 확정' : '같이할래?'}`}
                          onClick={() => toggleActivity(activity.id)}
                        >
                          {activity.joined
                            ? '참여 중 · 취소'
                            : activity.status === 'confirmed'
                              ? '약속 확정'
                              : '같이할래?'}
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {tab === '약속' && (
          <>
            <p className="page-description">참여한 활동을 여기서 확인해요.</p>
            {['recruiting', 'confirmed', 'completed'].map((status) => {
              const plans = activities.filter(
                (item) => item.joined && item.status === status
              )
              return (
                <section
                  className="plan-section"
                  key={status}
                  aria-labelledby={`plans-${status}`}
                >
                  <h2 id={`plans-${status}`}>
                    {status === 'completed'
                      ? '지난 약속'
                      : status === 'confirmed'
                        ? '확정된 약속'
                        : '모이는 중'}{' '}
                    <span className="muted">{plans.length}</span>
                  </h2>
                  {status === 'completed' && plans.length > 0 && (
                    <p className="muted">
                      다시 보고 싶은 사람을 골라요. 선택은 나만 볼 수 있어요.
                    </p>
                  )}
                  {plans.length === 0 && (
                    <p className="empty">
                      {status === 'completed'
                        ? '아직 지난 약속이 없어요.'
                        : status === 'confirmed'
                          ? '아직 확정된 약속이 없어요.'
                          : '오늘에서 같이할 일을 골라보세요.'}
                    </p>
                  )}
                  {plans.map((plan) => (
                    <article
                      className="plan-item"
                      key={plan.id}
                    >
                      <h3>{plan.title}</h3>
                      {plan.session > 0 && (
                        <p className="muted">다음 수업에서</p>
                      )}
                      <p className="muted">
                        {plan.className ??
                          classes.find((lesson) => lesson.id === plan.classId)
                            ?.name}
                      </p>
                      <p className="plan-location">
                        {plan.time} · {plan.place}
                      </p>
                      {plan.status === 'recruiting' && (
                        <p className="count">
                          {plan.count}/{plan.maxPeople}명 ·{' '}
                          {plan.maxPeople - plan.count}명 더 모이면 확정
                        </p>
                      )}
                      {plan.status === 'confirmed' && (
                        <button
                          type="button"
                          onClick={() => completeActivity(plan.id)}
                        >
                          만남 완료
                        </button>
                      )}
                      {plan.createdBy && plan.status === 'recruiting' && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void deleteCreatedActivity(plan.id)}
                        >
                          약속 삭제
                        </button>
                      )}
                      {plan.status === 'completed' && (
                        <>
                          <ul className="activity-list">
                            {plan.participantIds
                              .filter((id) => id !== currentUserId)
                              .map((id) => {
                                const selected =
                                  plan.mySelectedUserIds?.includes(id) ?? false
                                return (
                                  <li
                                    className="activity"
                                    key={id}
                                  >
                                    <span>{participantNames[id]}</span>
                                    <button
                                      type="button"
                                      className={`choice${selected ? ' is-selected' : ''}`}
                                      aria-pressed={selected}
                                      aria-label={`${participantNames[id]} 다시 보고 싶어요`}
                                      onClick={() => toggleFeedback(plan, id)}
                                    >
                                      {selected
                                        ? '선택됨 · 취소'
                                        : '다시 보고 싶어요'}
                                    </button>
                                  </li>
                                )
                              })}
                          </ul>
                        </>
                      )}
                    </article>
                  ))}
                </section>
              )
            })}
          </>
        )}
        {tab === '마이' && (
          <>
            <section
              className="my-section"
              aria-labelledby="profile-title"
            >
              <h2 id="profile-title">내 정보</h2>
              <dl className="profile">
                <div>
                  <dt>학과</dt>
                  <dd>소프트웨어학과</dd>
                </div>
                <div>
                  <dt>학번</dt>
                  <dd>2026310001</dd>
                </div>
              </dl>
            </section>
            <section
              className="my-section"
              aria-labelledby="schedule-title"
            >
              <h2 id="schedule-title">내 시간표</h2>
              {!editing ? (
                <>
                  <ul className="schedule-list">
                    {classes.map((lesson) => (
                      <li key={lesson.id}>
                        <strong>{lesson.name}</strong>
                        <span className="muted">
                          {lesson.start}–{lesson.end} · {lesson.room}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setDraft(classes)
                      setScheduleError('')
                      setEditing(true)
                    }}
                  >
                    시간표 수정
                  </button>
                </>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (
                      draft.some(
                        (lesson) =>
                          lesson.start >= lesson.end ||
                          !lesson.name.trim() ||
                          !lesson.room.trim()
                      )
                    ) {
                      setScheduleError(
                        '수업명과 강의실을 입력하고, 종료 시간을 시작 시간 이후로 설정해 주세요.'
                      )
                      return
                    }
                    setClasses(draft)
                    setEditing(false)
                    setNotice(
                      '시간표를 수정했어요. 추천 활동의 시간·장소는 고정된 샘플입니다.'
                    )
                  }}
                >
                  <p className="muted">
                    수정은 이 화면에만 적용돼요. 활동 시간은 바뀌지 않아요.
                  </p>
                  {draft.map((lesson, index) => (
                    <fieldset key={lesson.id}>
                      <legend>수업 {index + 1}</legend>
                      {(
                        [
                          ['name', '수업명'],
                          ['start', '시작 시간'],
                          ['end', '종료 시간'],
                          ['room', '강의실'],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          {label}
                          <input
                            required
                            type={
                              field === 'start' || field === 'end'
                                ? 'time'
                                : 'text'
                            }
                            value={lesson[field]}
                            onChange={(event) =>
                              setDraft((current) =>
                                current.map((item) =>
                                  item.id === lesson.id
                                    ? { ...item, [field]: event.target.value }
                                    : item
                                )
                              )
                            }
                          />
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  {scheduleError && (
                    <p
                      className="error"
                      role="alert"
                    >
                      {scheduleError}
                    </p>
                  )}
                  <div className="actions">
                    <button type="submit">저장</button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setEditing(false)}
                    >
                      취소
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}
      </main>
      <nav
        className="bottom-nav"
        aria-label="주요 메뉴"
      >
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? 'page' : undefined}
            onClick={() => {
              setTab(item)
              setNotice('')
              window.scrollTo(0, 0)
            }}
          >
            {item}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
