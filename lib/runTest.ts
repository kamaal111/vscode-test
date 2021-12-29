/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'path';
import { downloadAndUnzipVSCode, DownloadVersion, DownloadPlatform, defaultCachePath } from './download';

export interface TestOptions {
	/**
	 * The VS Code executable path used for testing.
	 *
	 * If not passed, will use `options.version` to download a copy of VS Code for testing.
	 * If `version` is not specified either, will download and use latest stable release.
	 */
	vscodeExecutablePath?: string;

	/**
	 * The VS Code version to download. Valid versions are:
	 * - `'stable'`
	 * - `'insiders'`
	 * - `'1.32.0'`, `'1.31.1'`, etc
	 *
	 * Defaults to `stable`, which is latest stable version.
	 *
	 * *If a local copy exists at `.vscode-test/vscode-<VERSION>`, skip download.*
	 */
	version?: DownloadVersion;

	/**
	 * The VS Code platform to download. If not specified, defaults to:
	 * - Windows: `win32-archive`
	 * - macOS: `darwin`
	 * - Linux: `linux-x64`
	 *
	 * Possible values are: `win32-archive`, `win32-x64-archive`, `darwin` and `linux-x64`.
	 */
	platform?: DownloadPlatform;

	/**
	 * Whether VS Code should be launched using default settings and extensions
	 * installed on this machine. If `false`, then separate directories will be
	 * used inside the `.vscode-test` folder within the project.
	 *
	 * Defaults to `false`.
	 */
	reuseMachineInstall?: boolean;

	/**
	 * Absolute path to the extension root. Passed to `--extensionDevelopmentPath`.
	 * Must include a `package.json` Extension Manifest.
	 */
	extensionDevelopmentPath: string;

	/**
	 * Absolute path to the extension tests runner. Passed to `--extensionTestsPath`.
	 * Can be either a file path or a directory path that contains an `index.js`.
	 * Must export a `run` function of the following signature:
	 *
	 * ```ts
	 * function run(): Promise<void>;
	 * ```
	 *
	 * When running the extension test, the Extension Development Host will call this function
	 * that runs the test suite. This function should throws an error if any test fails.
	 *
	 */
	extensionTestsPath: string;

	/**
	 * Environment variables being passed to the extension test script.
	 */
	extensionTestsEnv?: {
		[key: string]: string | undefined;
	};

	/**
	 * A list of launch arguments passed to VS Code executable, in addition to `--extensionDevelopmentPath`
	 * and `--extensionTestsPath` which are provided by `extensionDevelopmentPath` and `extensionTestsPath`
	 * options.
	 *
	 * If the first argument is a path to a file/folder/workspace, the launched VS Code instance
	 * will open it.
	 *
	 * See `code --help` for possible arguments.
	 */
	launchArgs?: string[];
}

/**
 * Run VS Code extension test
 *
 * @returns The exit code of the command to launch VS Code extension test
 */
export async function runTests(options: TestOptions): Promise<number> {
	if (!options.vscodeExecutablePath) {
		options.vscodeExecutablePath = await downloadAndUnzipVSCode(options.version, options.platform);
	}

	let args = [
		// https://github.com/microsoft/vscode/issues/84238
		'--no-sandbox',
		'--skip-welcome',
		'--skip-release-notes',
		'--disable-workspace-trust',
		'--extensionDevelopmentPath=' + options.extensionDevelopmentPath,
		'--extensionTestsPath=' + options.extensionTestsPath
	];

	if (options.launchArgs) {
		args = options.launchArgs.concat(args);
	}

	if (!options.reuseMachineInstall) {
		if (!hasArg('extensions-dir', args)) {
			args.push(`--extensions-dir=${path.join(defaultCachePath, 'extensions')}`)
		}

		if (!hasArg('user-data-dir', args)) {
			args.push(`--user-data-dir=${path.join(defaultCachePath, 'user-data')}`)
		}
	}

	return innerRunTests(options.vscodeExecutablePath, args, options.extensionTestsEnv);
}

function hasArg(argName: string, argList: readonly string[]) {
	return argList.some(a => a === `--${argName}` || a.startsWith(`--${argName}=`));
}

async function innerRunTests(
	executable: string,
	args: string[],
	testRunnerEnv?: {
		[key: string]: string | undefined;
	}
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const fullEnv = Object.assign({}, process.env, testRunnerEnv);
		const cmd = cp.spawn(executable, args, { env: fullEnv });

		cmd.stdout.on('data', d => process.stdout.write(d));
		cmd.stderr.on('data', d => process.stderr.write(d));

		cmd.on('error', function (data) {
			console.log('Test error: ' + data.toString());
		});

		let finished = false;
		function onProcessClosed(code: number | null, signal: NodeJS.Signals | null): void {
			if (finished) {
				return;
			}
			finished = true;
			console.log(`Exit code:   ${code ?? signal}`);

			if (code === null) {
				reject(signal);
			} else if (code !== 0) {
				reject('Failed');
			}

			console.log('Done\n');
			resolve(code ?? -1);
		}

		cmd.on('close', onProcessClosed);

		cmd.on('exit', onProcessClosed);
	});
}
