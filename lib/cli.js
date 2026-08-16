#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
//#endregion
//#region src/durable/maintenance.ts
function dshHome() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
function tokenDashboardDir(home = dshHome()) {
	return join(home, "data", "token-dashboard");
}
function canonicalDbPath(home = dshHome()) {
	return join(tokenDashboardDir(home), "usage-v1.sqlite");
}
function intentPath(home = dshHome()) {
	return join(tokenDashboardDir(home), "rebuild-intent.json");
}
/** Strict basename validation: exact file name, no separators/glob/absolute. */
function assertSafeBasename(name) {
	if (name.length === 0 || name !== basename(name) || name.includes(sep) || name === "." || name === "..") throw new Error("unsafe_basename: exact basename required");
	if (/[*?[\]]/.test(name)) throw new Error("unsafe_basename: glob characters are not allowed");
	return name;
}
function probeDatabase(dbPath) {
	if (!existsSync(dbPath)) return {
		exists: false,
		applicationId: null,
		userVersion: null,
		projectionVersion: null,
		phase: null,
		quickCheck: null
	};
	try {
		const db = new DatabaseSync(dbPath, {
			readOnly: true,
			timeout: 1e3
		});
		try {
			const appId = db.prepare("PRAGMA application_id").get().application_id;
			const userVersion = db.prepare("PRAGMA user_version").get().user_version;
			let projectionVersion = null;
			let phase = null;
			try {
				const row = db.prepare("SELECT projection_version, phase FROM projection_state WHERE singleton_id = 1").get();
				projectionVersion = row?.projection_version ?? null;
				phase = row?.phase ?? null;
			} catch {}
			const quickCheck = db.prepare("PRAGMA quick_check").get().quick_check;
			return {
				exists: true,
				applicationId: appId,
				userVersion,
				projectionVersion,
				phase,
				quickCheck
			};
		} finally {
			db.close();
		}
	} catch (error) {
		return {
			exists: true,
			applicationId: null,
			userVersion: null,
			projectionVersion: null,
			phase: null,
			quickCheck: null,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
function ensureDir(home) {
	const dir = tokenDashboardDir(home);
	mkdirSync(dir, {
		recursive: true,
		mode: 448
	});
	try {
		chmodSync(dir, 448);
	} catch {}
	return dir;
}
function writeIntent(home, payload) {
	const tmp = join(ensureDir(home), ".rebuild-intent.tmp-" + randomUUID());
	writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 384 });
	renameSync(tmp, intentPath(home));
	try {
		chmodSync(intentPath(home), 384);
	} catch {}
}
var MaintenanceManager = class {
	home;
	constructor(home = dshHome()) {
		this.home = home;
	}
	status() {
		const dir = tokenDashboardDir(this.home);
		const canonical = canonicalDbPath(this.home);
		const intent = existsSync(intentPath(this.home)) ? readFileSync(intentPath(this.home), "utf8") : null;
		const backups = [];
		const rebuilds = [];
		const corrupts = [];
		if (existsSync(dir)) {
			for (const name of readdirSync(dir)) if (name.startsWith("usage-v1.backup-")) backups.push(name);
			else if (name.startsWith("usage-v1.rebuild-")) rebuilds.push(name);
			else if (name.startsWith("usage-v1.corrupt-")) corrupts.push(name);
		}
		const probe = probeDatabase(canonical);
		return {
			home: this.home,
			dir,
			canonical,
			exists: probe.exists,
			applicationId: probe.applicationId,
			userVersion: probe.userVersion,
			projectionVersion: probe.projectionVersion,
			phase: probe.phase,
			intent,
			backups: backups.sort(),
			rebuilds: rebuilds.sort(),
			corrupts: corrupts.sort()
		};
	}
	verify(full = false) {
		const canonical = canonicalDbPath(this.home);
		const probe = probeDatabase(canonical);
		if (probe.exists && full) {
			const db = new DatabaseSync(canonical, {
				readOnly: true,
				timeout: 5e3
			});
			try {
				return {
					...probe,
					quickCheck: db.prepare("PRAGMA integrity_check").get().integrity_check
				};
			} finally {
				db.close();
			}
		}
		return probe;
	}
	rebuild() {
		const canonical = canonicalDbPath(this.home);
		if (existsSync(canonical)) {
			const probe = probeDatabase(canonical);
			if (probe.userVersion !== null && probe.userVersion > 1) throw new Error("database_too_new: refusing to rebuild a newer database");
			if (probe.applicationId !== null && probe.applicationId !== 0 && probe.applicationId !== 1146376011) throw new Error("foreign_database: refusing to rebuild a foreign database");
		}
		const intent = {
			version: 1,
			createdAtMs: Date.now(),
			target: "usage-v1.sqlite",
			shadow: `usage-v1.rebuild-${randomUUID()}.sqlite`,
			state: "intent"
		};
		writeIntent(this.home, intent);
		return { intent: JSON.stringify(intent) };
	}
	backups() {
		return this.status().backups;
	}
	restore(exactBasename, opts = {}) {
		assertSafeBasename(exactBasename);
		if (opts.yes !== true) throw new Error("confirmation_required: pass --yes after verifying the exact basename");
		const dir = ensureDir(this.home);
		const backupPath = join(dir, exactBasename);
		if (!existsSync(backupPath) || !statSync(backupPath).isFile()) throw new Error("backup_not_found: " + exactBasename);
		const canonical = canonicalDbPath(this.home);
		const preRestore = join(dir, `usage-v1.backup-${Date.now()}.sqlite`);
		if (existsSync(canonical)) renameSync(canonical, preRestore);
		renameSync(backupPath, canonical);
		try {
			chmodSync(canonical, 384);
		} catch {}
		return { restored: canonical };
	}
	cleanup(exactBasename, opts = {}) {
		assertSafeBasename(exactBasename);
		if (opts.yes !== true) throw new Error("confirmation_required: pass --yes after verifying the exact basename");
		const target = join(ensureDir(this.home), exactBasename);
		if (target === canonicalDbPath(this.home)) throw new Error("unsafe_cleanup: cannot cleanup canonical database");
		if (!existsSync(target) || !statSync(target).isFile()) throw new Error("file_not_found: " + exactBasename);
		rmSync(target, { force: true });
		return { removed: target };
	}
};
//#endregion
//#region src/cli.ts
function print(value) {
	process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
function fail(message, code = 1) {
	process.stderr.write(message + "\n");
	process.exit(code);
}
async function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	const manager = new MaintenanceManager();
	switch (command) {
		case "status":
			print(manager.status());
			return;
		case "verify":
			print(manager.verify(args.includes("--full")));
			return;
		case "rebuild":
			print(manager.rebuild());
			return;
		case "backups":
			print(manager.backups());
			return;
		case "restore": {
			const name = args[1];
			if (name === void 0) fail("usage: dsh-token-dashboard restore <exact-basename> [--yes]");
			print(manager.restore(name, { yes: args.includes("--yes") }));
			return;
		}
		case "cleanup": {
			const name = args[1];
			if (name === void 0) fail("usage: dsh-token-dashboard cleanup <exact-basename> [--yes]");
			print(manager.cleanup(name, { yes: args.includes("--yes") }));
			return;
		}
		default: fail("unknown command: " + (command ?? "(none)"));
	}
}
main().catch((error) => {
	fail(error instanceof Error ? error.message : String(error));
});
//#endregion
export {};

//# sourceMappingURL=cli.js.map