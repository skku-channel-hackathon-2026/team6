import {
  BadRequestException,
  Body,
  ConflictException,
  Delete,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Param,
  Patch,
  Put,
  Query,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getDatabase, type AppDatabase } from "./database.js";
import {
  demoCompleteActivity,
  demoCreateActivity,
  demoListMine,
  demoListToday,
  demoRemoveActivity,
  demoSetParticipation,
  demoSetPreference,
} from "./demo-store.js";
// Demo endpoints: never accept the acting user from request input.
export const DEMO_USER_ID = "me";
type ActivityRow = {
  id: string;
  classId: string;
  title: string;
  place: string;
  classStartsAt: string;
  startsAt: string;
  endsAt: string;
  maxPeople: number;
  status: "recruiting" | "confirmed" | "completed";
  count: number;
  joined: number;
  time: string;
  session: number;
  createdBy?: number;
};
type ClassRow = {
  id: string;
  name: string;
  start: string;
  end: string;
  room: string;
};

export function todayInSeoul() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type CreateActivityInput = {
  classId: string;
  title: string;
  place: string;
  startTime: string;
  endTime: string;
  maxPeople: number;
};

function parseCreateInput(body: unknown): CreateActivityInput {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("invalid activity input");
  const input = body as Record<string, unknown>;
  const keys = [
    "classId",
    "title",
    "place",
    "startTime",
    "endTime",
    "maxPeople",
  ];
  if (Object.keys(input).some((key) => !keys.includes(key)))
    throw new BadRequestException("invalid activity input");
  if (
    typeof input.classId !== "string" ||
    typeof input.title !== "string" ||
    typeof input.place !== "string" ||
    typeof input.startTime !== "string" ||
    typeof input.endTime !== "string" ||
    typeof input.maxPeople !== "number" ||
    !Number.isInteger(input.maxPeople) ||
    input.maxPeople < 2 ||
    input.maxPeople > 4 ||
    !/^\d{2}:\d{2}$/.test(input.startTime) ||
    !/^\d{2}:\d{2}$/.test(input.endTime) ||
    input.startTime >= input.endTime ||
    !input.title.trim() ||
    !input.place.trim()
  )
    throw new BadRequestException("invalid activity input");
  return input as CreateActivityInput;
}

function seoulTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}:00+09:00`)
    .toISOString()
    .replace(".000Z", "Z");
}

export async function createActivity(
  database: AppDatabase,
  input: CreateActivityInput,
) {
  const date = todayInSeoul();
  const id = randomUUID();
  const classRow = await database
    .prepare(
      `
    SELECT c.id, c.start_time AS classStart, c.end_time AS classEnd,
      EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.user_id = ?) AS enrolled
    FROM classes c WHERE c.id = ? AND c.weekday = CAST(strftime('%w', ?) AS INTEGER)
  `,
    )
    .bind(DEMO_USER_ID, input.classId, date)
    .first<{
      id: string;
      classStart: string;
      classEnd: string;
      enrolled: number;
    }>();
  if (!classRow) throw new NotFoundException("Class not found for today");
  if (!classRow.enrolled)
    throw new ForbiddenException("Class enrollment required");
  const classStartsAt = seoulTimestamp(date, classRow.classStart);
  const startsAt = seoulTimestamp(date, input.startTime);
  const endsAt = seoulTimestamp(date, input.endTime);
  await database.batch([
    database
      .prepare(
        `INSERT INTO activities
      (id, class_id, class_starts_at, starts_at, ends_at, title, place, max_people, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recruiting', ?)
    `,
      )
      .bind(
        id,
        input.classId,
        classStartsAt,
        startsAt,
        endsAt,
        input.title.trim(),
        input.place.trim(),
        input.maxPeople,
        DEMO_USER_ID,
      ),
    database
      .prepare(
        "INSERT INTO activity_participants(activity_id, user_id) VALUES (?, ?)",
      )
      .bind(id, DEMO_USER_ID),
  ]);
  return {
    id,
    classId: input.classId,
    title: input.title.trim(),
    place: input.place.trim(),
    time: input.startTime,
    maxPeople: input.maxPeople,
    count: 1,
    joined: true,
    status: "recruiting" as const,
    createdBy: true,
  };
}

export async function removeActivity(database: AppDatabase, id: string) {
  const activity = await database
    .prepare(
      `SELECT id, status, created_by AS createdBy,
    (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = activities.id) AS count
    FROM activities WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      createdBy: string | null;
      count: number;
    }>();
  if (!activity) throw new NotFoundException("Activity not found");
  if (activity.createdBy !== DEMO_USER_ID)
    throw new ForbiddenException("Only the creator can delete this activity");
  if (activity.status !== "recruiting" || activity.count !== 1)
    throw new ConflictException(
      "Only an empty recruiting activity can be deleted",
    );
  await database.batch([
    database
      .prepare("DELETE FROM rematch_preferences WHERE activity_id = ?")
      .bind(id),
    database
      .prepare("DELETE FROM activity_participants WHERE activity_id = ?")
      .bind(id),
    database
      .prepare("DELETE FROM activities WHERE id = ? AND created_by = ?")
      .bind(id, DEMO_USER_ID),
  ]);
  return { id, deleted: true };
}

export async function listMyActivities(database: AppDatabase) {
  const classes = await database
    .prepare(
      `
    SELECT DISTINCT c.id, c.name, c.start_time AS start, c.end_time AS end, c.room
    FROM classes c JOIN activities a ON a.class_id = c.id
    JOIN activity_participants p ON p.activity_id = a.id WHERE p.user_id = ?
    ORDER BY c.start_time, c.id
  `,
    )
    .bind(DEMO_USER_ID)
    .all<ClassRow>();
  const activities = await database
    .prepare(
      `
    SELECT a.id, a.class_id AS classId, a.title, a.place,
      a.class_starts_at AS classStartsAt, a.starts_at AS startsAt, a.ends_at AS endsAt,
      a.max_people AS maxPeople, a.status, (a.created_by = ?) AS createdBy,
      (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id) AS count,
      1 AS joined, strftime('%H:%M', a.starts_at, '+9 hours') AS time,
      CASE WHEN date(a.class_starts_at, '+9 hours') > ? THEN 1 ELSE 0 END AS session
    FROM activities a JOIN activity_participants mine ON mine.activity_id = a.id
    WHERE mine.user_id = ? ORDER BY a.class_starts_at, a.starts_at, a.id
  `,
    )
    .bind(DEMO_USER_ID, todayInSeoul(), DEMO_USER_ID)
    .all<ActivityRow>();
  const participants = await database
    .prepare(
      `
    SELECT p.activity_id AS activityId, u.id, u.name FROM activity_participants p
    JOIN users u ON u.id = p.user_id
    WHERE EXISTS(SELECT 1 FROM activity_participants mine
      WHERE mine.activity_id = p.activity_id AND mine.user_id = ?)
    ORDER BY p.activity_id, u.id
  `,
    )
    .bind(DEMO_USER_ID)
    .all<{ activityId: string; id: string; name: string }>();
  const selections = await database
    .prepare(
      `
    SELECT r.activity_id AS activityId, r.to_user_id AS targetUserId
    FROM rematch_preferences r JOIN activities a ON a.id = r.activity_id
    WHERE r.from_user_id = ? AND a.status = 'completed'
      AND EXISTS(SELECT 1 FROM activity_participants p WHERE p.activity_id = r.activity_id AND p.user_id = ?)
    ORDER BY r.activity_id, r.to_user_id
  `,
    )
    .bind(DEMO_USER_ID, DEMO_USER_ID)
    .all<{ activityId: string; targetUserId: string }>();
  return {
    classes: classes.results,
    activities: activities.results.map((activity) => ({
      ...activity,
      joined: true,
      prioritySuggested: false,
      participants: participants.results
        .filter((p) => p.activityId === activity.id)
        .map(({ id, name }) => ({ id, name })),
      mySelectedUserIds: selections.results
        .filter((r) => r.activityId === activity.id)
        .map((r) => r.targetUserId),
    })),
  };
}

export async function completeActivity(database: AppDatabase, id: string) {
  const result = await database.batch<Record<string, unknown>>([
    database
      .prepare(
        `UPDATE activities SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ? AND status = 'confirmed' AND EXISTS(
        SELECT 1 FROM activity_participants p WHERE p.activity_id = activities.id AND p.user_id = ?)
    `,
      )
      .bind(id, DEMO_USER_ID),
    database
      .prepare(
        `SELECT a.id, a.status, EXISTS(SELECT 1 FROM activity_participants p
      WHERE p.activity_id = a.id AND p.user_id = ?) AS joined FROM activities a WHERE a.id = ?
    `,
      )
      .bind(DEMO_USER_ID, id),
  ]);
  const activity = result[1].results[0];
  if (!activity) throw new NotFoundException("Activity not found");
  if (!activity.joined) throw new ForbiddenException("Participation required");
  if (activity.status !== "completed")
    throw new ConflictException("Activity must be confirmed");
  return { activity: { id, status: "completed" as const } };
}

export async function setPreference(
  database: AppDatabase,
  id: string,
  targetUserId: string,
  selected: boolean,
) {
  if (targetUserId === DEMO_USER_ID)
    throw new BadRequestException("Cannot select yourself");
  // Repeat the authorization predicate in the mutation itself, inside the D1 batch.
  const allowed = `SELECT 1 FROM activities a
    JOIN activity_participants mine ON mine.activity_id = a.id AND mine.user_id = ?
    JOIN activity_participants target ON target.activity_id = a.id AND target.user_id = ?
    WHERE a.id = ? AND a.status = 'completed'`;
  const mutation = selected
    ? database
        .prepare(
          `INSERT INTO rematch_preferences(activity_id, from_user_id, to_user_id)
        SELECT ?, ?, ? WHERE EXISTS(${allowed})
        ON CONFLICT(activity_id, from_user_id, to_user_id) DO NOTHING
      `,
        )
        .bind(id, DEMO_USER_ID, targetUserId, DEMO_USER_ID, targetUserId, id)
    : database
        .prepare(
          `DELETE FROM rematch_preferences
        WHERE activity_id = ? AND from_user_id = ? AND to_user_id = ? AND EXISTS(${allowed})
      `,
        )
        .bind(id, DEMO_USER_ID, targetUserId, DEMO_USER_ID, targetUserId, id);
  const result = await database.batch<Record<string, unknown>>([
    database
      .prepare(
        `SELECT a.status,
      EXISTS(SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?) AS mine,
      EXISTS(SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?) AS target
      FROM activities a WHERE a.id = ?
    `,
      )
      .bind(DEMO_USER_ID, targetUserId, id),
    mutation,
    database
      .prepare(
        `SELECT to_user_id AS targetUserId FROM rematch_preferences
      WHERE activity_id = ? AND from_user_id = ? ORDER BY to_user_id
    `,
      )
      .bind(id, DEMO_USER_ID),
  ]);
  const activity = result[0].results[0];
  if (!activity) throw new NotFoundException("Activity not found");
  if (!activity.mine || !activity.target)
    throw new ForbiddenException("Both users must be participants");
  if (activity.status !== "completed")
    throw new ConflictException("Activity must be completed");
  return {
    activityId: id,
    mySelectedUserIds: result[2].results.map(
      (row) => row.targetUserId as string,
    ),
  };
}

export async function setParticipation(
  database: AppDatabase,
  id: string,
  joined: boolean,
) {
  const snapshot = database
    .prepare(
      `
    SELECT a.id, a.status,
      EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id = a.class_id AND e.user_id = ?) AS enrolled
    FROM activities a WHERE a.id = ?
  `,
    )
    .bind(DEMO_USER_ID, id);
  const mutation = joined
    ? database
        .prepare(
          `
        INSERT INTO activity_participants (activity_id, user_id)
        SELECT a.id, ? FROM activities a
        WHERE a.id = ? AND a.status = 'recruiting'
          AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id = a.class_id AND e.user_id = ?)
          AND (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id) < a.max_people
        ON CONFLICT(activity_id, user_id) DO NOTHING
      `,
        )
        .bind(DEMO_USER_ID, id, DEMO_USER_ID)
    : database
        .prepare(
          `
        DELETE FROM activity_participants WHERE activity_id = ? AND user_id = ?
          AND EXISTS(SELECT 1 FROM activities a JOIN enrollments e ON e.class_id = a.class_id
            WHERE a.id = activity_id AND a.status <> 'completed' AND e.user_id = ?)
      `,
        )
        .bind(id, DEMO_USER_ID, DEMO_USER_ID);
  // D1 executes the conditional mutation, status update and response read in one
  // transaction. No separate read-then-write window can overbook the activity.
  const result = await database.batch<Record<string, unknown>>([
    snapshot,
    mutation,
    database
      .prepare(
        `
      UPDATE activities SET status = CASE
        WHEN (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = activities.id) >= max_people
          THEN 'confirmed' ELSE 'recruiting' END
      WHERE id = ? AND status <> 'completed'
        AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id = activities.class_id AND e.user_id = ?)
    `,
      )
      .bind(id, DEMO_USER_ID),
    database
      .prepare(
        `
      SELECT a.id, a.status, a.max_people AS maxPeople,
        (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id) AS count,
        EXISTS(SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?) AS joined
      FROM activities a WHERE a.id = ?
    `,
      )
      .bind(DEMO_USER_ID, id),
  ]);
  const before = result[0].results[0];
  if (!before) throw new NotFoundException("Activity not found");
  if (!before.enrolled)
    throw new ForbiddenException("Class enrollment required");
  const activity = result[3].results[0] as Pick<
    ActivityRow,
    "id" | "status" | "maxPeople" | "count" | "joined"
  >;
  if (Boolean(activity.joined) !== joined) {
    throw new ConflictException(
      before.status === "completed"
        ? "Activity already completed"
        : "Activity is full or closed",
    );
  }
  return { activity: { ...activity, joined: Boolean(activity.joined) } };
}

export async function listTodayActivities(database: AppDatabase, date: string) {
  const classes = await database
    .prepare(
      `
    SELECT c.id, c.name, c.start_time AS start, c.end_time AS end, c.room
    FROM classes c JOIN enrollments e ON e.class_id = c.id
    WHERE e.user_id = ? AND c.weekday = CAST(strftime('%w', ?) AS INTEGER)
    ORDER BY c.start_time, c.id
  `,
    )
    .bind(DEMO_USER_ID, date)
    .all<ClassRow>();
  const activities = await database
    .prepare(
      `
    SELECT a.id, a.class_id AS classId, a.title, a.place,
      a.class_starts_at AS classStartsAt, a.starts_at AS startsAt,
      a.ends_at AS endsAt, a.max_people AS maxPeople, a.status,
      (a.created_by = ?) AS createdBy,
      (SELECT COUNT(*) FROM activity_participants p WHERE p.activity_id = a.id) AS count,
      EXISTS(SELECT 1 FROM activity_participants p WHERE p.activity_id = a.id AND p.user_id = ?) AS joined,
      strftime('%H:%M', a.starts_at, '+9 hours') AS time,
      CASE WHEN date(a.class_starts_at, '+9 hours') = ? THEN 0 ELSE 1 END AS session
    FROM activities a
    JOIN classes c ON c.id = a.class_id
    JOIN enrollments e ON e.class_id = c.id AND e.user_id = ?
    WHERE c.weekday = CAST(strftime('%w', ?) AS INTEGER)
      AND a.status <> 'completed'
      AND (date(a.class_starts_at, '+9 hours') = ? OR
        a.class_starts_at = (
          SELECT MIN(next.class_starts_at) FROM activities next
          WHERE next.class_id = a.class_id AND next.status <> 'completed'
            AND date(next.class_starts_at, '+9 hours') > ?
        ))
    ORDER BY a.class_starts_at, a.starts_at, a.id
  `,
    )
    .bind(DEMO_USER_ID, DEMO_USER_ID, date, DEMO_USER_ID, date, date, date)
    .all<ActivityRow>();
  return {
    classes: classes.results,
    activities: activities.results.map((activity) => ({
      ...activity,
      joined: Boolean(activity.joined),
      // Rematching is outside this first read-only API implementation.
      prioritySuggested: false,
    })),
  };
}

@Controller("api/activities")
export class ActivitiesController {
  @Post()
  create(@Body() body: unknown) {
    return demoCreateActivity(getDatabase(), parseCreateInput(body));
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return demoRemoveActivity(getDatabase(), id);
  }

  @Put(":id/preferences/:targetUserId")
  preference(
    @Param("id") id: string,
    @Param("targetUserId") targetUserId: string,
    @Body() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("selected" in body) ||
      typeof body.selected !== "boolean" ||
      Object.keys(body).some((key) => key !== "selected")
    ) {
      throw new BadRequestException("body must be { selected: boolean }");
    }

    return demoSetPreference(getDatabase(), id, targetUserId, body.selected);
  }

  @Patch(":id")
  complete(@Param("id") id: string, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("status" in body) ||
      body.status !== "completed" ||
      Object.keys(body).some((key) => key !== "status")
    ) {
      throw new BadRequestException("body must be { status: 'completed' }");
    }

    return demoCompleteActivity(getDatabase(), id);
  }

  @Put(":id/participation")
  participation(@Param("id") id: string, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("joined" in body) ||
      typeof body.joined !== "boolean" ||
      Object.keys(body).some((key) => key !== "joined")
    ) {
      throw new BadRequestException("body must be { joined: boolean }");
    }

    return demoSetParticipation(getDatabase(), id, body.joined);
  }

  @Get()
  list(@Query("scope") scope: unknown, @Query("date") inputDate: unknown) {
    if (scope === "mine") {
      return demoListMine(getDatabase());
    }

    if (scope !== "today") {
      throw new BadRequestException("scope must be today or mine");
    }

    const date = inputDate === undefined ? todayInSeoul() : inputDate;

    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException("date must be a valid YYYY-MM-DD date");
    }

    return demoListToday(getDatabase());
  }
}
