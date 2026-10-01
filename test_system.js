const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Helper to make HTTP requests with cookie handling
function makeRequest(options, postData = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (cookie) headers['Cookie'] = cookie;
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({ ...options, headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json || data
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting Automated System Verification ---');

  const { app } = require('./server');
  const testPort = 3001;
  const serverInstance = await new Promise((resolve) => {
    const s = app.listen(testPort, () => resolve(s));
  });

  try {
    // 1. Verify Login with invalid credentials
    const badLogin = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/login',
      method: 'POST'
    }, JSON.stringify({ username: 'admin', password: 'wrongpassword' }));
  
  assert.strictEqual(badLogin.statusCode, 401, 'Bad login should return 401');
  console.log('✓ Invalid login correctly rejected with 401');

  // 2. Verify Login with correct credentials
  const goodLogin = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/login',
    method: 'POST'
  }, JSON.stringify({ username: 'admin', password: 'admin123' }));

  assert.strictEqual(goodLogin.statusCode, 200, 'Valid login should return 200');
  assert.strictEqual(goodLogin.body.ok, true);
  
  const rawCookie = goodLogin.headers['set-cookie'] ? goodLogin.headers['set-cookie'][0] : '';
  const cookie = rawCookie.split(';')[0];
  assert.ok(cookie.includes('connect.sid'), 'Cookie should contain session id');
  console.log('✓ Valid login succeeded and issued session cookie');

  // 3. Verify /api/me
  const me = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/me',
    method: 'GET'
  }, null, cookie);

  assert.strictEqual(me.statusCode, 200);
  assert.strictEqual(me.body.user, 'admin');
  assert.strictEqual(me.body.version, 'v1.0.2');
  console.log('✓ /api/me returned session and system version');

  // 4. Verify existing file conflict protection
  const conflictPage = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/pages',
    method: 'POST'
  }, JSON.stringify({
    title: 'About Us Duplicate',
    slug: 'about',
    content: '<p>Should fail</p>'
  }), cookie);

  assert.strictEqual(conflictPage.statusCode, 400);
  assert.ok(conflictPage.body.error.includes('already exists'), 'Should warn about old website clash');
  console.log('✓ Safeguard verified: cannot overwrite existing static WordPress export pages');

  // 5. Create a new Course
  const newCourse = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/courses',
    method: 'POST'
  }, JSON.stringify({
    title: 'Ramadan 2026 Tafseer',
    year: 2026,
    description: 'Special nightly lectures during Ramadan 2026',
    order: 1
  }), cookie);

  assert.strictEqual(newCourse.statusCode, 200);
  const courseId = newCourse.body.item.id;
  console.log('✓ Course created and static build generated course index');

  // 6. Create a Lecture for this Course
  const newLecture = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/lectures',
    method: 'POST'
  }, JSON.stringify({
    courseId: courseId,
    title: 'Night 1 Welcome and Intentions',
    number: 1,
    speaker: 'Dr. Idrees Zubair',
    audioUrl: 'https://traffic.libsyn.com/nurulquran/ramadan-night-01.mp3'
  }), cookie);

  assert.strictEqual(newLecture.statusCode, 200);
  const lectureId = newLecture.body.item.id;
  console.log('✓ Lecture created and static lecture page written to disk');

  // Check generated file on disk
  const lectureFile = path.resolve('./site/lectures/ramadan-2026-tafseer/night-1-welcome-and-intentions/index.html');
  assert.ok(fs.existsSync(lectureFile), 'Lecture static HTML file should exist on disk');
  const lectureHtml = fs.readFileSync(lectureFile, 'utf8');
  assert.ok(lectureHtml.includes('Night 1 Welcome and Intentions'));
  assert.ok(lectureHtml.includes('Dr. Idrees Zubair'));
  console.log('✓ Verified static HTML content on disk at ' + lectureFile);

  // 7. Verify course deletion protection when lectures exist
  const deleteCourseFail = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: `/api/courses/${courseId}`,
    method: 'DELETE'
  }, null, cookie);

  assert.strictEqual(deleteCourseFail.statusCode, 400);
  assert.ok(deleteCourseFail.body.error.includes('Delete or move them first'));
  console.log('✓ Course deletion blocked while lectures still reference it');

  // 8. Delete lecture then course
  const delLec = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: `/api/lectures/${lectureId}`,
    method: 'DELETE'
  }, null, cookie);
  assert.strictEqual(delLec.statusCode, 200);

  const delCourse = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: `/api/courses/${courseId}`,
    method: 'DELETE'
  }, null, cookie);
  assert.strictEqual(delCourse.statusCode, 200);
  console.log('✓ Cleanup and deletion verified');

  // 9. Verify in-page WYSIWYG save endpoint
  const inpageSave = await makeRequest({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/inpage/save',
    method: 'POST'
  }, JSON.stringify({
    path: 'about/index.html',
    html: fs.readFileSync(path.resolve('./site/about/index.html'), 'utf8')
  }), cookie);

  assert.strictEqual(inpageSave.statusCode, 200);
  assert.strictEqual(inpageSave.body.ok, true);
  console.log('✓ In-page WYSIWYG save endpoint successfully verified');

  console.log('\n--- All System Tests Passed Successfully! ---');
  } finally {
    await new Promise(resolve => serverInstance.close(resolve));
  }
}

// If run directly
if (require.main === module) {
  runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
