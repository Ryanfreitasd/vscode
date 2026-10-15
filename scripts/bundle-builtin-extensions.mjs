import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import cp from 'child_process';
import os from 'os';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, '.build', 'builtInExtensions');

const EXTENSIONS_TO_BUNDLE = [
	'ms-azuretools.vscode-containers',
	'Dart-Code.dart-code',
	'Dart-Code.flutter',
	'firsttris.vscode-jest-runner',
	'vscjava.vscode-java-pack',
	'redhat.java',
	'vscjava.vscode-java-debug',
	'vscjava.vscode-java-test',
	'vscjava.vscode-maven',
	'vscjava.vscode-gradle',
	'vscjava.vscode-java-dependency'
];

function fetchJson(url, postData) {
	return new Promise((resolve, reject) => {
		const req = https.request(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json;api-version=3.0-preview.1'
			}
		}, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch (err) {
					reject(new Error(`Failed to parse JSON response: ${err.message}`));
				}
			});
		});
		req.on('error', reject);
		req.write(JSON.stringify(postData));
		req.end();
	});
}

function fetchBuffer(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				return fetchBuffer(res.headers.location).then(resolve, reject);
			}
			if (res.statusCode !== 200) {
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
			}
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				let buf = Buffer.concat(chunks);
				// If response is gzipped, decompress
				if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
					try {
						buf = zlib.gunzipSync(buf);
					} catch (e) {
						// not gzip or failed
					}
				}
				resolve(buf);
			});
			res.on('error', reject);
		});
	});
}

async function queryExtension(extensionIdentifier) {
	const query = {
		filters: [{
			criteria: [
				{ filterType: 7, value: extensionIdentifier }
			]
		}],
		flags: 1039
	};
	const result = await fetchJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', query);
	if (!result.results?.[0]?.extensions?.[0]) {
		throw new Error(`Extension ${extensionIdentifier} not found on marketplace`);
	}
	return result.results[0].extensions[0];
}

async function processExtension(extId) {
	console.log(`\n=== Processing ${extId} ===`);
	const data = await queryExtension(extId);
	const versionInfo = data.versions[0];
	const version = versionInfo.version;
	const publisherName = data.publisher.publisherName;
	const extensionName = data.extensionName;
	const fullName = `${publisherName}.${extensionName}`;

	const packageFile = versionInfo.files.find(f => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
	if (!packageFile) {
		throw new Error(`No VSIXPackage asset found for ${extId}`);
	}

	console.log(`Downloading ${fullName}@${version} from ${packageFile.source}...`);
	const vsixBuffer = await fetchBuffer(packageFile.source);

	const sha256 = crypto.createHash('sha256').update(vsixBuffer).digest('hex');
	console.log(`Downloaded ${vsixBuffer.length} bytes. SHA256: ${sha256}`);

	const targetPath = path.join(outDir, fullName);
	fs.rmSync(targetPath, { recursive: true, force: true });
	fs.mkdirSync(targetPath, { recursive: true });

	const tempZipPath = path.join(os.tmpdir(), `temp-${fullName}-${Date.now()}.zip`);
	fs.writeFileSync(tempZipPath, vsixBuffer);

	const tempExtractDir = path.join(os.tmpdir(), `temp-extract-${fullName}-${Date.now()}`);
	fs.mkdirSync(tempExtractDir, { recursive: true });

	try {
		console.log(`Extracting to ${targetPath}...`);
		cp.execSync(`unzip -q -o "${tempZipPath}" "extension/*" -d "${tempExtractDir}"`);
		const extractedExtensionDir = path.join(tempExtractDir, 'extension');
		if (fs.existsSync(extractedExtensionDir)) {
			// Move all contents to targetPath
			for (const file of fs.readdirSync(extractedExtensionDir)) {
				fs.cpSync(path.join(extractedExtensionDir, file), path.join(targetPath, file), { recursive: true });
			}
		}
	} finally {
		fs.rmSync(tempZipPath, { force: true });
		fs.rmSync(tempExtractDir, { recursive: true, force: true });
	}

	// Read repository url if available from package.json
	let repo = '';
	try {
		const pkgJson = JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'));
		if (typeof pkgJson.repository === 'string') {
			repo = pkgJson.repository;
		} else if (pkgJson.repository?.url) {
			repo = pkgJson.repository.url;
		}
	} catch (e) {}

	const extDef = {
		name: fullName,
		version: version,
		sha256: sha256,
		repo: repo || `https://github.com/${publisherName}/${extensionName}`,
		metadata: {
			id: data.extensionId,
			publisherId: {
				publisherId: data.publisher.publisherId,
				publisherName: publisherName,
				displayName: data.publisher.displayName || publisherName,
				flags: data.publisher.flags || 'verified'
			},
			publisherDisplayName: data.publisher.displayName || publisherName
		}
	};

	console.log(`Done processing ${fullName}`);
	return extDef;
}

async function main() {
	fs.mkdirSync(outDir, { recursive: true });
	const results = [];

	for (const extId of EXTENSIONS_TO_BUNDLE) {
		try {
			const extDef = await processExtension(extId);
			results.push(extDef);
		} catch (err) {
			console.error(`Error processing ${extId}:`, err);
			process.exit(1);
		}
	}

	const productJsonPath = path.join(root, 'product.json');
	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

	// Existing built-in extensions to keep (like js-debug, js-debug-companion, js-profile-table)
	const existing = (productJson.builtInExtensions || []).filter(e => !EXTENSIONS_TO_BUNDLE.some(toBundle => toBundle.toLowerCase() === e.name.toLowerCase()));

	productJson.builtInExtensions = [...existing, ...results];

	fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t') + '\n', 'utf8');
	console.log(`\nSuccessfully updated product.json with ${results.length} new builtInExtensions!`);
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
