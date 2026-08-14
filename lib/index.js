//#region src/host/day-buckets.ts
const HOUR_MS = 36e5;
/** Machine-local UTC offset (hours, positive east) at the given instant. */
function localOffsetHours(time) {
	return -new Date(time).getTimezoneOffset() / 60;
}
function offsetHoursFor(tz, time, localOffset = localOffsetHours) {
	return tz === "utc" ? 0 : localOffset(time);
}
/** YYYY-MM-DD of an epoch-ms instant under the timezone policy. */
function dayKeyOf(time, tz, localOffset = localOffsetHours) {
	return new Date(time + offsetHoursFor(tz, time, localOffset) * HOUR_MS).toISOString().slice(0, 10);
}
/** YYYY-MM-DD shifted by N days (pure, timezone-independent calendar math). */
function shiftDateKey(key, days) {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function emptyBucket(date) {
	return {
		date,
		totalTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		requests: 0,
		byModel: []
	};
}
function addUsage(bucket, sample) {
	const usage = sample.usage;
	const input = usage.inputTokens ?? 0;
	const output = usage.outputTokens ?? 0;
	const cacheRead = usage.cacheReadTokens ?? 0;
	bucket.inputTokens += input;
	bucket.outputTokens += output;
	bucket.totalTokens += input + output + cacheRead;
	bucket.cacheReadTokens += cacheRead;
	bucket.requests += 1;
	const provider = sample.provider ?? "unknown";
	const model = sample.model ?? "unknown";
	const key = provider + "\0" + model;
	const byModel = bucket.byModelMap ?? (bucket.byModelMap = /* @__PURE__ */ new Map());
	let entry = byModel.get(key);
	if (entry === void 0) {
		entry = {
			provider,
			model,
			tokens: 0
		};
		byModel.set(key, entry);
	}
	entry.tokens += input + output + cacheRead;
}
/** Aggregate every sample into the full day-bucket map (no window truncation). */
function buildBucketMap(samples, tz, localOffset = localOffsetHours) {
	const buckets = /* @__PURE__ */ new Map();
	for (const sample of samples) {
		const key = dayKeyOf(sample.time, tz, localOffset);
		let bucket = buckets.get(key);
		if (bucket === void 0) {
			bucket = emptyBucket(key);
			buckets.set(key, bucket);
		}
		addUsage(bucket, sample);
	}
	for (const bucket of buckets.values()) {
		const map = bucket.byModelMap;
		if (map !== void 0) {
			bucket.byModel = [...map.values()].sort((a, b) => b.tokens - a.tokens);
			delete bucket.byModelMap;
		}
	}
	return buckets;
}
/**
* Zero-filled day buckets for the window
* [today - (offsetWeeks + weeks) * 7 + 1, today - offsetWeeks * 7], oldest
* first (05 decision: 26-week default window, offset paging).
*/
function buildDays(samples, tz, weeks, offsetWeeks, now = Date.now(), localOffset = localOffsetHours) {
	const buckets = buildBucketMap(samples, tz, localOffset);
	const todayKey = dayKeyOf(now, tz, localOffset);
	const start = shiftDateKey(todayKey, -((offsetWeeks + weeks) * 7) + 1);
	const end = shiftDateKey(todayKey, -offsetWeeks * 7);
	const days = [];
	for (let key = start; key <= end; key = shiftDateKey(key, 1)) days.push(buckets.get(key) ?? emptyBucket(key));
	return days;
}
/** Rolling totals for the panel header, summed from the full bucket map. */
function buildSummary(buckets, tz, now = Date.now(), localOffset = localOffsetHours) {
	const todayKey = dayKeyOf(now, tz, localOffset);
	let today = 0;
	let week = 0;
	let month30 = 0;
	let all = 0;
	let cacheReadAll = 0;
	for (const [key, bucket] of buckets) {
		all += bucket.totalTokens;
		cacheReadAll += bucket.cacheReadTokens;
		if (key === todayKey) today = bucket.totalTokens;
		if (key > shiftDateKey(todayKey, -7) && key <= todayKey) week += bucket.totalTokens;
		if (key > shiftDateKey(todayKey, -30) && key <= todayKey) month30 += bucket.totalTokens;
	}
	return {
		today,
		week,
		month30,
		all,
		cacheReadAll
	};
}
//#endregion
//#region src/host/usage-fold.ts
/**
* Fold a contiguous event log into one sample per (turn, step), last wins.
* Returns samples sorted by event time (stable for day bucketing).
*/
function foldUsage(events) {
	const byStep = /* @__PURE__ */ new Map();
	let provider;
	let model;
	for (const event of events) {
		if (event.type === "request/header") {
			const config = event.data.header.config;
			if (typeof config.provider === "string") provider = config.provider;
			if (typeof config.model === "string") model = config.model;
			continue;
		}
		if (event.type === "request/context") {
			if (typeof event.data.provider === "string") provider = event.data.provider;
			if (typeof event.data.model === "string") model = event.data.model;
			continue;
		}
		if (event.type === "assistant/message") {
			const usage = event.data.usage;
			if (usage !== void 0) {
				const { turn, step } = event.data;
				byStep.set(turn + ":" + step, {
					turn,
					step,
					time: event.time,
					usage,
					provider,
					model
				});
			}
			continue;
		}
		if (event.type === "assistant/chunk") {
			const chunk = event.data.chunk;
			if (chunk.type === "usage") {
				const { turn, step } = event.data;
				const key = turn + ":" + step;
				if (!byStep.has(key)) byStep.set(key, {
					turn,
					step,
					time: event.time,
					usage: chunk.usage,
					provider,
					model
				});
			}
		}
	}
	return [...byStep.values()].sort((a, b) => a.time - b.time);
}
/** Merge tail samples into an existing fold (incremental refresh). */
function mergeUsage(existing, incoming) {
	for (const sample of incoming) existing.set(sample.turn + ":" + sample.step, sample);
}
//#endregion
//#region src/host/aggregator.ts
var TokenAggregator = class {
	persistence;
	sessions = /* @__PURE__ */ new Map();
	refreshChain = Promise.resolve();
	lastSessionCount = 0;
	constructor(persistence) {
		this.persistence = persistence;
	}
	/** Serialized refresh: one cold/增量 pass per call, concurrent callers queue. */
	refresh() {
		this.refreshChain = this.refreshChain.then(() => this.doRefresh());
		return this.refreshChain;
	}
	async doRefresh() {
		const snapshots = await this.persistence.listSnapshots();
		this.lastSessionCount = snapshots.length;
		const seen = /* @__PURE__ */ new Set();
		for (const snapshot of snapshots) {
			const id = snapshot.header.id;
			seen.add(id);
			const revision = String(snapshot.revision);
			const cached = this.sessions.get(id);
			if (cached !== void 0 && cached.revision === revision) continue;
			if (cached !== void 0) {
				const tail = await this.persistence.readFrom(id, cached.lastSeq + 1);
				const samples = foldUsage(tail.events);
				mergeUsage(cached.fold, samples);
				cached.lastSeq = tail.events.reduce((max, event) => Math.max(max, event.seq), cached.lastSeq);
				cached.revision = revision;
			} else {
				const inspection = await this.persistence.inspect(id);
				const fold = new Map(foldUsage(inspection.events).map((sample) => [sample.turn + ":" + sample.step, sample]));
				const lastSeq = inspection.events.reduce((max, event) => Math.max(max, event.seq), -1);
				this.sessions.set(id, {
					revision,
					lastSeq,
					fold
				});
			}
		}
		for (const id of this.sessions.keys()) if (!seen.has(id)) this.sessions.delete(id);
	}
	allSamples() {
		const samples = [];
		for (const cache of this.sessions.values()) samples.push(...cache.fold.values());
		return samples;
	}
	/** Rolling totals for the panel header (summed over all history). */
	summary(tz) {
		return {
			...buildSummary(buildBucketMap(this.allSamples(), tz), tz),
			sessionCount: this.lastSessionCount
		};
	}
	/** Zero-filled day buckets for the requested window (05: 26w default, paged). */
	days(tz, weeks, offsetWeeks) {
		return buildDays(this.allSamples(), tz, weeks, offsetWeeks);
	}
};
//#endregion
//#region src/host/routes.ts
const DEFAULT_WEEKS = 26;
const MAX_WEEKS = 52;
function ok(res, value) {
	res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({
		ok: true,
		value
	}));
}
function fail(res, status, code, message) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({
		ok: false,
		error: {
			code,
			message
		}
	}));
}
function queryOf(req) {
	return new URL(req.url ?? "/", "http://localhost").searchParams;
}
function tzOf(params) {
	const tz = params.get("tz") ?? "local";
	return tz === "local" || tz === "utc" ? tz : null;
}
function intOf(params, name, fallback, min, max) {
	const raw = params.get(name);
	if (raw === null) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) return null;
	return value;
}
/**
* Register the dashboard routes on ctx.webServer.
* Returns a disposer that removes both routes (wired via ctx.effect).
*/
function registerTokenRoutes(ctx, aggregator) {
	const disposeSummary = ctx.webServer.register({
		kind: "exact",
		path: "/api/token-dashboard/summary",
		handler: async (req, res) => {
			try {
				const tz = tzOf(queryOf(req));
				if (tz === null) return fail(res, 400, "bad-query", "tz must be local or utc");
				await aggregator.refresh();
				ok(res, aggregator.summary(tz));
			} catch (error) {
				fail(res, 500, "internal", error instanceof Error ? error.message : String(error));
			}
		}
	});
	const disposeDays = ctx.webServer.register({
		kind: "exact",
		path: "/api/token-dashboard/days",
		handler: async (req, res) => {
			try {
				const params = queryOf(req);
				const tz = tzOf(params);
				if (tz === null) return fail(res, 400, "bad-query", "tz must be local or utc");
				const weeks = intOf(params, "weeks", DEFAULT_WEEKS, 1, MAX_WEEKS);
				if (weeks === null) return fail(res, 400, "bad-query", "weeks must be an integer in [1, 52]");
				const offsetWeeks = intOf(params, "offsetWeeks", 0, 0, 1e4);
				if (offsetWeeks === null) return fail(res, 400, "bad-query", "offsetWeeks must be a non-negative integer");
				await aggregator.refresh();
				ok(res, {
					tz,
					weeks,
					offsetWeeks,
					days: aggregator.days(tz, weeks, offsetWeeks)
				});
			} catch (error) {
				fail(res, 500, "internal", error instanceof Error ? error.message : String(error));
			}
		}
	});
	return () => {
		disposeDays();
		disposeSummary();
	};
}
//#endregion
//#region src/index.ts
/** Required services: the HTTP route registry and the session-log read seam. */
const inject = ["webServer", "sessionPersistence"];
/** Mount the aggregation service and its routes. */
function apply(ctx) {
	const aggregator = new TokenAggregator(ctx.sessionPersistence);
	ctx.effect(() => registerTokenRoutes(ctx, aggregator), "dsh-token-dashboard: /api/token-dashboard routes");
}
//#endregion
export { apply, inject };

//# sourceMappingURL=index.js.map