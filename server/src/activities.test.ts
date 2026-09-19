import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ActivitiesController,
  listTodayActivities,
  setParticipation,
  setPreference,
  listMyActivities,
  completeActivity,
  createActivity,
  removeActivity,
} from "./activities.js";
import type { AppDatabase, DatabaseStatement } from "./database.js";

const sql = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const migrationRoot = "../../cloudflare/";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(sql(`${migrationRoot}migrations/0001_initial.sql`));
  sqlite.exec(sql(`${migrationRoot}migrations/0002_activity_flow.sql`));
  sqlite.exec(sql(`${migrationRoot}migrations/0003_activity_ownership.sql`));
  sqlite.exec(sql(`${migrationRoot}seed.sql`));
  const queries = new WeakMap<
    DatabaseStatement,
    () => Record<string, unknown>[]
  >();
  const database: AppDatabase = {
    prepare(query) {
      let values: (string | number | null)[] = [];
      const statement: DatabaseStatement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async all<T>() {
          return {
            success: true,
            meta: {},
            results: sqlite.prepare(query).all(...values) as T[],
          };
        },
        async first<T>() {
          return (
            (sqlite.prepare(query).get(...values) as T | undefined) ?? null
          );
        },
        async run<T>() {
          const result = sqlite.prepare(query).run(...values);
          return {
            success: true,
            meta: { changes: Number(result.changes) },
            results: [] as T[],
          };
        },
      };
      queries.set(statement, () => sqlite.prepare(query).all(...values));
      return statement;
    },
    async batch<T>(statements: DatabaseStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => ({
          results: queries.get(statement)!() as T[],
          success: true,
          meta: {},
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, database };
}

test("today returns demo classes, counts, membership and the next class occurrence", async () => {
  const { sqlite, database } = fixture();
  try {
    const data = await listTodayActivities(database, "2026-09-19");
    assert.equal(data.classes.length, 3);
    assert.equal(data.activities.length, 3);
    const coffee = data.activities.find((item) => item.id === "coffee")!;
    assert.equal(coffee.time, "08:30"); // Stored on the previous UTC day.
    assert.equal(coffee.count, 1);
    assert.equal(coffee.joined, false);
    const walk = data.activities.find((item) => item.id === "english-walk")!;
    assert.equal(walk.joined, true);
    assert.equal(walk.status, "confirmed");
    assert.equal(walk.count, walk.maxPeople);
    assert.equal(
      data.activities.find((item) => item.id === "english-walk")!.session,
      0,
    );
    assert(
      data.activities.every(
        (item) => !("participantIds" in item) && !("mySelectedUserIds" in item),
      ),
    );
    assert.deepEqual(await listTodayActivities(database, "2026-09-20"), {
      classes: [],
      activities: [],
    });
    sqlite.exec(
      "DELETE FROM enrollments WHERE user_id = 'me' AND class_id = 'writing'",
    );
    sqlite.exec(
      "UPDATE activities SET status = 'completed', completed_at = '2026-09-19T06:00:00Z' WHERE id = 'english-walk'",
    );
    const filtered = await listTodayActivities(database, "2026-09-19");
    assert(
      filtered.activities.every(
        (item) => item.classId !== "writing" && item.status !== "completed",
      ),
    );
  } finally {
    sqlite.close();
  }
});

test("seed is repeatable and schema rejects invalid references, duplicates and checks", () => {
  const { sqlite } = fixture();
  try {
    sqlite.exec(sql(`${migrationRoot}seed.sql`));
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM activity_participants").get()!
        .n,
      6,
    );
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() =>
      sqlite.exec(
        "INSERT INTO activity_participants(activity_id,user_id) VALUES ('coffee','missing')",
      ),
    );
    assert.throws(() =>
      sqlite.exec(
        "INSERT INTO activity_participants(activity_id,user_id) VALUES ('coffee','jiyun')",
      ),
    );
    assert.throws(() =>
      sqlite.exec("UPDATE activities SET max_people = 5 WHERE id = 'coffee'"),
    );
    assert.throws(() =>
      sqlite.exec(
        "UPDATE activities SET status = 'unknown' WHERE id = 'coffee'",
      ),
    );
    assert.throws(() =>
      sqlite.exec(
        "UPDATE activities SET status = 'completed' WHERE id = 'coffee'",
      ),
    );
    assert.throws(() =>
      sqlite.exec(
        "INSERT INTO rematch_preferences(activity_id,from_user_id,to_user_id) VALUES ('coffee','jiyun','jiyun')",
      ),
    );
    assert.throws(() =>
      sqlite.exec(
        "INSERT INTO rematch_preferences(activity_id,from_user_id,to_user_id) VALUES ('coffee','jiyun','me')",
      ),
    );
  } finally {
    sqlite.close();
  }
});

test("query rejects unsupported scopes, invalid calendar dates and repeated parameters", () => {
  const controller = new ActivitiesController();
  assert.throws(() => controller.list("unknown", "2026-09-19"));
  for (const date of ["2026-02-30", "bad", ["2026-09-19"], "2026-13-01"]) {
    assert.throws(() => controller.list("today", date));
  }
});

test("preferences require completed activity and both participants, including cancellation", async () => {
  const { sqlite, database } = fixture();
  try {
    for (const selected of [true, false]) {
      await assert.rejects(
        setPreference(database, "missing", "minseo", selected),
        { status: 404 },
      );
      await assert.rejects(
        setPreference(database, "english-walk", "me", selected),
        { status: 400 },
      );
      await assert.rejects(
        setPreference(database, "english-walk", "minseo", selected),
        { status: 409 },
      );
      await assert.rejects(
        setPreference(database, "coffee", "jiyun", selected),
        { status: 403 },
      );
    }
    await completeActivity(database, "english-walk");
    await completeActivity(database, "english-walk");
    await assert.rejects(
      setPreference(database, "english-walk", "jiyun", true),
      { status: 403 },
    );
    await assert.rejects(
      setPreference(database, "english-walk", "missing", false),
      { status: 403 },
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM rematch_preferences").get()!.n,
      0,
    );
    await assert.rejects(completeActivity(database, "lunch"), { status: 409 });
    await assert.rejects(completeActivity(database, "coffee"), { status: 403 });
  } finally {
    sqlite.close();
  }
});

test("preferences are idempotent, restored by mine, and never expose incoming choices", async () => {
  const { sqlite, database } = fixture();
  try {
    await completeActivity(database, "english-walk");
    const before = await listMyActivities(database);
    sqlite.exec(
      "INSERT INTO rematch_preferences(activity_id,from_user_id,to_user_id) VALUES ('english-walk','minseo','me')",
    );
    assert.deepEqual(await listMyActivities(database), before);
    const expected = {
      activityId: "english-walk",
      mySelectedUserIds: ["minseo"],
    };
    for (const response of await Promise.all(
      Array.from({ length: 5 }, () =>
        setPreference(database, "english-walk", "minseo", true),
      ),
    )) {
      assert.deepEqual(response, expected);
    }
    const mine = await listMyActivities(database);
    const completed = mine.activities.find(
      (item) => item.id === "english-walk",
    )!;
    assert.deepEqual(completed.mySelectedUserIds, ["minseo"]);
    assert.deepEqual(completed.participants, [
      { id: "me", name: "나" },
      { id: "minseo", name: "민서" },
    ]);
    assert(mine.activities.every((item) => item.joined));
    assert(!mine.activities.some((item) => item.id === "tea"));
    for (let i = 0; i < 2; i++)
      assert.deepEqual(
        await setPreference(database, "english-walk", "minseo", false),
        { activityId: "english-walk", mySelectedUserIds: [] },
      );
    assert.deepEqual(await listMyActivities(database), before);
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM rematch_preferences WHERE from_user_id='minseo'",
        )
        .get()!.n,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("preference body accepts only selected boolean", () => {
  const controller = new ActivitiesController();
  for (const body of [
    null,
    [],
    {},
    { selected: "true" },
    { selected: 1 },
    { selected: true, userId: "minseo" },
  ]) {
    assert.throws(() => controller.preference("english-walk", "minseo", body), {
      status: 400,
    });
  }
});

test("participation confirms the last slot and repeated joins/cancels are idempotent", async () => {
  const { sqlite, database } = fixture();
  try {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        setParticipation(database, "coffee", true),
      ),
    );
    for (const { activity } of responses) {
      assert.equal(activity.count, 2);
      assert.equal(activity.status, "confirmed");
      assert.equal(activity.joined, true);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { activity } = await setParticipation(database, "coffee", false);
      assert.equal(activity.count, 1);
      assert.equal(activity.status, "recruiting");
      assert.equal(activity.joined, false);
    }
    const { activity: alreadyJoined } = await setParticipation(
      database,
      "coffee",
      true,
    );
    assert.equal(alreadyJoined.count, 2);
    assert.equal(alreadyJoined.status, "confirmed");
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id='coffee'",
        )
        .get()!.n,
      2,
    );
    const { activity } = await setParticipation(database, "coffee", false);
    assert.equal(activity.count, 1);
    assert.equal(activity.status, "recruiting");
    assert.equal(activity.joined, false);
  } finally {
    sqlite.close();
  }
});

test("participation rejects missing, completed and unenrolled activities without changing membership", async () => {
  const { sqlite, database } = fixture();
  try {
    await assert.rejects(setParticipation(database, "missing", true), {
      status: 404,
    });
    sqlite.exec(
      "UPDATE activities SET status='completed', completed_at='2026-09-19T06:00:00Z' WHERE id='english-walk'",
    );
    await assert.rejects(setParticipation(database, "english-walk", false), {
      status: 409,
    });
    assert.equal(
      (await setParticipation(database, "english-walk", true)).activity.joined,
      true,
    );
    sqlite.exec(
      "DELETE FROM enrollments WHERE user_id='me' AND class_id='writing'",
    );
    await assert.rejects(setParticipation(database, "coffee", true), {
      status: 403,
    });
    assert.equal(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM activity_participants WHERE user_id='me'",
        )
        .get()!.n,
      3,
    );
    assert.equal(
      sqlite
        .prepare("SELECT status FROM activities WHERE id='english-walk'")
        .get()!.status,
      "completed",
    );
  } finally {
    sqlite.close();
  }
});

test("participation body requires a boolean and cannot override the demo user", () => {
  const controller = new ActivitiesController();
  for (const body of [
    undefined,
    null,
    [],
    {},
    { joined: "true" },
    { joined: true, userId: "jiyun" },
  ]) {
    assert.throws(() => controller.participation("coffee", body), {
      status: 400,
    });
  }
});

test("creator can create a recruiting activity and delete it before others join", async () => {
  const { sqlite, database } = fixture();
  try {
    const created = await createActivity(database, {
      classId: "writing",
      title: "수업 후 산책",
      place: "인문관 앞",
      startTime: "10:20",
      endTime: "10:40",
      maxPeople: 2,
    });
    assert.equal(created.joined, true);
    assert.equal(created.createdBy, true);
    const row = sqlite
      .prepare(
        "SELECT created_by AS createdBy, status FROM activities WHERE id = ?",
      )
      .get(created.id) as { createdBy: string; status: string };
    assert.equal(row.createdBy, "me");
    assert.equal(row.status, "recruiting");
    assert.deepEqual(await removeActivity(database, created.id), {
      id: created.id,
      deleted: true,
    });
    assert.equal(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM activities WHERE id = ?")
        .get(created.id)!.n,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("only the creator can delete, and joined activities cannot be deleted", async () => {
  const { sqlite, database } = fixture();
  try {
    await assert.rejects(removeActivity(database, "coffee"), { status: 403 });
    const created = await createActivity(database, {
      classId: "writing",
      title: "같이 복습",
      place: "도서관",
      startTime: "10:20",
      endTime: "10:40",
      maxPeople: 3,
    });
    sqlite
      .prepare(
        "INSERT INTO activity_participants(activity_id, user_id) VALUES (?, ?)",
      )
      .run(created.id, "jiyun");
    await assert.rejects(removeActivity(database, created.id), { status: 409 });
  } finally {
    sqlite.close();
  }
});
