import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./database.js";

const STATE_ID = "team6-demo-state";
const USER_ID = "me";

type Status = "recruiting" | "confirmed" | "completed";

type DemoClass = {
  id: string;
  name: string;
  start: string;
  end: string;
  room: string;
};

type DemoActivity = {
  id: string;
  classId: string;
  title: string;
  place: string;
  time: string;
  maxPeople: number;
  status: Status;
  participantIds: string[];
  createdBy?: string;
};

type DemoState = {
  classes: DemoClass[];
  users: Record<string, string>;
  activities: DemoActivity[];
  preferences: Record<string, string[]>;
};
let memoryState: DemoState | null = null;

type CreateInput = {
  classId: string;
  title: string;
  place: string;
  startTime: string;
  endTime: string;
  maxPeople: number;
};

function initialState(): DemoState {
  return {
    classes: [
      {
        id: "writing",
        name: "글쓰기 기초",
        start: "09:00",
        end: "10:15",
        room: "인문관 201호",
      },
      {
        id: "coding",
        name: "컴퓨팅 사고",
        start: "11:00",
        end: "12:15",
        room: "정보관 302호",
      },
      {
        id: "english",
        name: "대학 영어",
        start: "14:00",
        end: "15:15",
        room: "인문관 104호",
      },
    ],

    users: {
      me: "나",
      jiyun: "지윤",
      minseo: "민서",
    },

    activities: [
      {
        id: "coffee",
        classId: "writing",
        title: "수업 전 커피",
        place: "정문 카페 앞",
        time: "08:30",
        maxPeople: 2,
        status: "recruiting",
        participantIds: ["jiyun"],
      },
      {
        id: "lunch",
        classId: "coding",
        title: "수업 후 같이 밥",
        place: "학생식당 입구",
        time: "12:20",
        maxPeople: 4,
        status: "recruiting",
        participantIds: ["me"],
      },
      {
        id: "english-walk",
        classId: "english",
        title: "같이 강의실 가기",
        place: "인문관 1층 로비",
        time: "13:50",
        maxPeople: 2,
        status: "confirmed",
        participantIds: ["me", "minseo"],
      },
      {
        id: "previous-english-coffee",
        classId: "english",
        title: "수업 전 커피",
        place: "정문 카페 앞",
        time: "13:20",
        maxPeople: 2,
        status: "completed",
        participantIds: ["me", "jiyun"],
      },
    ],

    preferences: {},
  };
}

async function save(database: AppDatabase, state: DemoState) {
  memoryState = state;

  try {
    await database
      .prepare(
        `
        INSERT INTO app_records (id, value_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
        `,
      )
      .bind(STATE_ID, JSON.stringify(state))
      .run();
  } catch {
    // 원격 D1 테이블이 없어도 데모는 메모리 상태로 계속 동작
  }
}

async function load(database: AppDatabase): Promise<DemoState> {
  try {
    const row = await database
      .prepare("SELECT value_json FROM app_records WHERE id = ?")
      .bind(STATE_ID)
      .first<{ value_json: string }>();

    if (row) {
      const state = JSON.parse(row.value_json) as DemoState;
      memoryState = state;
      return state;
    }
  } catch {
    // D1 미구성 시 아래 메모리 fallback 사용
  }

  if (memoryState) {
    return memoryState;
  }

  const state = initialState();
  memoryState = state;

  try {
    await save(database, state);
  } catch {
    // ignore
  }

  return state;
}

function view(activity: DemoActivity) {
  return {
    id: activity.id,
    classId: activity.classId,
    title: activity.title,
    place: activity.place,
    time: activity.time,
    maxPeople: activity.maxPeople,
    count: activity.participantIds.length,
    joined: activity.participantIds.includes(USER_ID),
    status: activity.status,
    session: 0,
    createdBy: activity.createdBy === USER_ID,
    prioritySuggested: false,
  };
}

export async function demoListToday(database: AppDatabase) {
  const state = await load(database);

  return {
    classes: state.classes,
    activities: state.activities
      .filter((activity) => activity.status !== "completed")
      .map(view),
  };
}

export async function demoListMine(database: AppDatabase) {
  const state = await load(database);

  const mine = state.activities.filter((activity) =>
    activity.participantIds.includes(USER_ID),
  );

  const classIds = new Set(mine.map((activity) => activity.classId));

  return {
    classes: state.classes.filter((item) => classIds.has(item.id)),

    activities: mine.map((activity) => ({
      ...view(activity),

      participants: activity.participantIds.map((id) => ({
        id,
        name: state.users[id] ?? id,
      })),

      mySelectedUserIds: state.preferences[activity.id] ?? [],
    })),
  };
}

export async function demoCreateActivity(
  database: AppDatabase,
  input: CreateInput,
) {
  const state = await load(database);

  if (!state.classes.some((item) => item.id === input.classId)) {
    throw new NotFoundException("Class not found");
  }

  const activity: DemoActivity = {
    id: randomUUID(),
    classId: input.classId,
    title: input.title.trim(),
    place: input.place.trim(),
    time: input.startTime,
    maxPeople: input.maxPeople,
    status: "recruiting",
    participantIds: [USER_ID],
    createdBy: USER_ID,
  };

  state.activities.push(activity);
  await save(database, state);

  return view(activity);
}

export async function demoRemoveActivity(database: AppDatabase, id: string) {
  const state = await load(database);
  const activity = state.activities.find((item) => item.id === id);

  if (!activity) {
    throw new NotFoundException("Activity not found");
  }

  if (activity.createdBy !== USER_ID) {
    throw new ForbiddenException("Only the creator can delete this activity");
  }

  if (
    activity.status !== "recruiting" ||
    activity.participantIds.length !== 1
  ) {
    throw new ConflictException(
      "Only an empty recruiting activity can be deleted",
    );
  }

  state.activities = state.activities.filter((item) => item.id !== id);
  delete state.preferences[id];

  await save(database, state);

  return {
    id,
    deleted: true,
  };
}

export async function demoSetParticipation(
  database: AppDatabase,
  id: string,
  joined: boolean,
) {
  const state = await load(database);
  const activity = state.activities.find((item) => item.id === id);

  if (!activity) {
    throw new NotFoundException("Activity not found");
  }

  const alreadyJoined = activity.participantIds.includes(USER_ID);

  if (activity.status === "completed") {
    if (alreadyJoined === joined) {
      return { activity: view(activity) };
    }

    throw new ConflictException("Activity already completed");
  }

  if (joined) {
    if (!alreadyJoined) {
      if (
        activity.status !== "recruiting" ||
        activity.participantIds.length >= activity.maxPeople
      ) {
        throw new ConflictException("Activity is full or closed");
      }

      activity.participantIds.push(USER_ID);
    }
  } else {
    activity.participantIds = activity.participantIds.filter(
      (id) => id !== USER_ID,
    );
  }

  activity.status =
    activity.participantIds.length >= activity.maxPeople
      ? "confirmed"
      : "recruiting";

  await save(database, state);

  return {
    activity: view(activity),
  };
}

export async function demoCompleteActivity(database: AppDatabase, id: string) {
  const state = await load(database);
  const activity = state.activities.find((item) => item.id === id);

  if (!activity) {
    throw new NotFoundException("Activity not found");
  }

  if (!activity.participantIds.includes(USER_ID)) {
    throw new ForbiddenException("Participation required");
  }

  if (activity.status === "completed") {
    return {
      activity: {
        id,
        status: "completed" as const,
      },
    };
  }

  if (activity.status !== "confirmed") {
    throw new ConflictException("Activity must be confirmed");
  }

  activity.status = "completed";
  await save(database, state);

  return {
    activity: {
      id,
      status: "completed" as const,
    },
  };
}

export async function demoSetPreference(
  database: AppDatabase,
  id: string,
  targetUserId: string,
  selected: boolean,
) {
  if (targetUserId === USER_ID) {
    throw new BadRequestException("Cannot select yourself");
  }

  const state = await load(database);
  const activity = state.activities.find((item) => item.id === id);

  if (!activity) {
    throw new NotFoundException("Activity not found");
  }

  if (
    !activity.participantIds.includes(USER_ID) ||
    !activity.participantIds.includes(targetUserId)
  ) {
    throw new ForbiddenException("Both users must be participants");
  }

  if (activity.status !== "completed") {
    throw new ConflictException("Activity must be completed");
  }

  const selectedIds = new Set(state.preferences[id] ?? []);

  if (selected) {
    selectedIds.add(targetUserId);
  } else {
    selectedIds.delete(targetUserId);
  }

  state.preferences[id] = [...selectedIds];

  await save(database, state);

  return {
    activityId: id,
    mySelectedUserIds: state.preferences[id],
  };
}
