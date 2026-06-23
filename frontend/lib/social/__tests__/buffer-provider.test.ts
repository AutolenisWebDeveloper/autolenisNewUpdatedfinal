// BufferProvider GraphQL-shape tests.
// Run with:
//   tsx --test lib/social/__tests__/buffer-provider.test.ts
//
// These lock the provider's requests to the real Buffer GraphQL schema:
//   • createPost puts media in `assets` (@oneOf image/video) — never `media`.
//   • publishNow uses mode `shareNow`; schedulePost uses `customScheduled` + dueAt.
//   • getAnalytics reads Post.metrics (PostMetric[]) and maps them to our fields,
//     leaving unavailable metrics null.
//   • listBufferPosts parses the Relay connection from posts().

import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferProvider,
  listBufferPosts,
  editBufferPost,
} from "../providers/buffer.provider";

interface Captured {
  body: { query: string; variables?: Record<string, unknown> };
}

// Captures each GraphQL request body and returns a scripted response chosen by
// the query text. `responder` maps a query substring → data payload.
function stubFetch(responder: (query: string, vars: Record<string, unknown>) => unknown): {
  restore: () => void;
  calls: Captured[];
} {
  const original = global.fetch;
  const calls: Captured[] = [];
  global.fetch = (async (_input: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Captured["body"];
    calls.push({ body });
    const data = responder(body.query, body.variables ?? {});
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ data }),
      json: async () => ({ data }),
    };
  }) as unknown as typeof fetch;
  return { restore: () => { global.fetch = original; }, calls };
}

test("publishNow: uses shareNow mode and `assets` (not `media`)", async () => {
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_PROFILE_FACEBOOK = "chan_fb"; // short-circuits channel resolution

  const { restore, calls } = stubFetch(() => ({
    createPost: { __typename: "PostActionSuccess", post: { id: "p_1", status: "sent" } },
  }));
  try {
    const res = await new BufferProvider().publishNow({
      postId: "local_1",
      platform: "facebook",
      caption: "hello",
      hashtags: ["deals"],
      imageUrl: "https://cdn.example/img.jpg",
    });
    assert.equal(res.success, true);
    assert.equal(res.platformPostId, "p_1");

    const input = calls[0].body.variables!.input as Record<string, unknown>;
    assert.equal(input.mode, "shareNow");
    assert.equal(input.channelId, "chan_fb");
    assert.equal(input.schedulingType, "automatic");
    assert.ok(!("media" in input), "must NOT send a `media` field");
    assert.deepEqual(input.assets, [{ image: { url: "https://cdn.example/img.jpg" } }]);
  } finally {
    restore();
  }
});

test("schedulePost: uses customScheduled mode with dueAt and a video asset", async () => {
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_PROFILE_TIKTOK = "chan_tt";

  const { restore, calls } = stubFetch(() => ({
    createPost: { __typename: "PostActionSuccess", post: { id: "p_2", status: "scheduled" } },
  }));
  try {
    const when = new Date("2030-01-01T12:00:00.000Z");
    const res = await new BufferProvider().schedulePost({
      postId: "local_2",
      platform: "tiktok",
      caption: "vid",
      hashtags: [],
      videoUrl: "https://cdn.example/v.mp4",
      thumbnailUrl: "https://cdn.example/t.jpg",
      isVideo: true,
      scheduledAt: when,
    });
    assert.equal(res.success, true);

    const input = calls[0].body.variables!.input as Record<string, unknown>;
    assert.equal(input.mode, "customScheduled");
    assert.equal(input.dueAt, when.toISOString());
    assert.deepEqual(input.assets, [
      { video: { url: "https://cdn.example/v.mp4", thumbnailUrl: "https://cdn.example/t.jpg" } },
    ]);
  } finally {
    restore();
  }
});

test("createPost: surfaces a MutationError message as a failed result", async () => {
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_PROFILE_FACEBOOK = "chan_fb";

  const { restore } = stubFetch(() => ({
    createPost: { __typename: "InvalidInputError", message: "Channel is disconnected" },
  }));
  try {
    const res = await new BufferProvider().publishNow({
      postId: "x", platform: "facebook", caption: "c", hashtags: [],
    });
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /disconnected/);
  } finally {
    restore();
  }
});

test("getAnalytics: maps Post.metrics to fields; unavailable metrics stay null", async () => {
  process.env.BUFFER_API_KEY = "test-key";

  const { restore, calls } = stubFetch((query) => {
    assert.match(query, /post\(input:/, "must query post(input: { id })");
    return {
      post: {
        id: "p_1",
        status: "sent",
        metrics: [
          { type: "likes", value: 5 },
          { type: "reactions", value: 3 },
          { type: "impressions", value: 100 },
          { type: "clicks", value: 7 },
        ],
      },
    };
  });
  try {
    const a = await new BufferProvider().getAnalytics("p_1");
    assert.equal(a.likes, 8); // likes + reactions
    assert.equal(a.impressions, 100);
    assert.equal(a.clicks, 7);
    assert.equal(a.comments, null); // not returned → null (not 0)
    assert.equal(a.reach, null);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("listBufferPosts: parses the Relay connection and pagination", async () => {
  process.env.BUFFER_API_KEY = "test-key";
  process.env.BUFFER_ORGANIZATION_ID = "org_x"; // skips the account query

  const { restore, calls } = stubFetch((query) => {
    assert.match(query, /posts\(input:/);
    return {
      posts: {
        edges: [
          {
            cursor: "c1",
            node: {
              id: "p_1",
              status: "scheduled",
              via: "api",
              text: "queued post",
              channelId: "chan_fb",
              channelService: "facebook",
              channel: { id: "chan_fb", name: "AutoLenis FB", service: "facebook" },
              assets: [{ type: "image", thumbnail: "https://cdn/x.jpg" }],
              allowedActions: ["updatePost", "deletePost"],
            },
          },
        ],
        pageInfo: { endCursor: "c1", hasNextPage: true },
      },
    };
  });
  try {
    const res = await listBufferPosts({ statuses: ["scheduled"], first: 10 });
    assert.equal(res.error, undefined);
    assert.equal(res.posts.length, 1);
    assert.equal(res.posts[0].id, "p_1");
    assert.equal(res.posts[0].channelService, "facebook");
    assert.equal(res.posts[0].channelName, "AutoLenis FB");
    assert.equal(res.hasNextPage, true);
    assert.equal(res.endCursor, "c1");

    const input = calls[0].body.variables!.input as { organizationId: string; filter?: { status?: string[] } };
    assert.equal(input.organizationId, "org_x");
    assert.deepEqual(input.filter?.status, ["scheduled"]);
  } finally {
    restore();
  }
});

test("editBufferPost: reschedule sends customScheduled + dueAt", async () => {
  process.env.BUFFER_API_KEY = "test-key";

  const { restore, calls } = stubFetch(() => ({
    editPost: { __typename: "PostActionSuccess", post: { id: "p_1", status: "scheduled" } },
  }));
  try {
    const res = await editBufferPost({ id: "p_1", dueAtIso: "2030-02-02T10:00:00.000Z" });
    assert.equal(res.success, true);
    const input = calls[0].body.variables!.input as Record<string, unknown>;
    assert.equal(input.id, "p_1");
    assert.equal(input.mode, "customScheduled");
    assert.equal(input.dueAt, "2030-02-02T10:00:00.000Z");
    assert.equal(input.schedulingType, "automatic");
  } finally {
    restore();
  }
});
