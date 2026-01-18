const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const extensionConfig = {
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	};

	const webviewConfig = {
		entryPoints: ['src/webview.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		external: [],
		logLevel: 'silent',
		assetNames: 'fonts/[name]',
		loader: {
			'.woff2': 'file',
			'.woff': 'file',
			'.ttf': 'file',
		},
		define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
		plugins: [esbuildProblemMatcherPlugin],
	};

	if (watch) {
		const ctxExt = await esbuild.context(extensionConfig);
		const ctxWeb = await esbuild.context(webviewConfig);
		await ctxExt.watch();
		await ctxWeb.watch();
	} else {
		await esbuild.build(extensionConfig);
		await esbuild.build(webviewConfig);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
