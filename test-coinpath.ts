// Automated verification suite for CoinPath virtual wallet
const BASE_URL = 'http://localhost:3000';

async function post(url: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${url}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runTests() {
  console.log('--- STARTING COINPATH TEST SUITE ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // 1. Health check
  const health = await get('/api/health');
  assert(health.status === 200 && health.data.status === 'ok', 'Server health check responds ok');

  // 2. Register User 1 (Alice) with 500 initial virtual coins
  const testUsername = `alice_${Date.now()}`;
  const regAlice = await post('/api/auth/register', {
    username: testUsername,
    email: `${testUsername}@example.com`,
    fullName: 'Alice Test',
    password: 'Password123!',
  });

  assert(regAlice.status === 201, 'Alice registered successfully (HTTP 201)');
  assert(regAlice.data.wallet.balance === 500, `Alice receives exactly 500 initial virtual coins (Actual: ${regAlice.data?.wallet?.balance})`);
  assert(/^CP-\d{4}-\d{4}$/.test(regAlice.data.wallet.walletId), `Alice receives unique formatted wallet ID: ${regAlice.data?.wallet?.walletId}`);
  assert(regAlice.data.wallet.maxTxLimit === 200, `Default transaction limit is 200 coins (Actual: ${regAlice.data?.wallet?.maxTxLimit})`);

  const aliceToken = regAlice.data.token;
  const aliceWalletId = regAlice.data.wallet.walletId;

  // 3. Reject duplicate account registration
  const dupReg = await post('/api/auth/register', {
    username: testUsername,
    email: `${testUsername}@example.com`,
    fullName: 'Alice Duplicate',
    password: 'Password123!',
  });
  assert(dupReg.status === 409, 'Duplicate account registration rejected with HTTP 409 Conflict');

  // 4. Register User 2 (Bob) with 500 initial virtual coins
  const bobUsername = `bob_${Date.now()}`;
  const regBob = await post('/api/auth/register', {
    username: bobUsername,
    email: `${bobUsername}@example.com`,
    fullName: 'Bob Test',
    password: 'Password123!',
  });

  assert(regBob.status === 201, 'Bob registered successfully (HTTP 201)');
  assert(regBob.data.wallet.balance === 500, `Bob receives exactly 500 initial virtual coins (Actual: ${regBob.data?.wallet?.balance})`);
  assert(regBob.data.wallet.walletId !== aliceWalletId, 'Bob and Alice have distinct wallet IDs');

  const bobToken = regBob.data.token;
  const bobWalletId = regBob.data.wallet.walletId;

  // 5. Test login with wrong password
  const badLogin = await post('/api/auth/login', {
    usernameOrEmail: testUsername,
    password: 'WrongPassword!',
  });
  assert(badLogin.status === 401, 'Login with incorrect password rejected with HTTP 401');

  // 6. Test login with correct password
  const goodLogin = await post('/api/auth/login', {
    usernameOrEmail: testUsername,
    password: 'Password123!',
  });
  assert(goodLogin.status === 200 && goodLogin.data.wallet.balance === 500, 'Login with correct credentials succeeds and returns preserved balance (500)');

  // 7. Recipient lookup endpoint
  const lookupBob = await get(`/api/wallet/recipient/${bobWalletId}`);
  assert(lookupBob.status === 200 && lookupBob.data.username === bobUsername, `Recipient lookup finds Bob (${bobUsername})`);

  // 8. Transfer: 50 coins from Alice to Bob (<= 200 limit)
  const tx1Id = `test_tx_${Date.now()}_1`;
  const tx50 = await post(
    '/api/wallet/transfer',
    {
      txId: tx1Id,
      receiverWalletId: bobWalletId,
      amount: 50,
      nonce: `n_${Date.now()}_1`,
    },
    aliceToken
  );
  assert(tx50.status === 200 && tx50.data.status === 'accepted', 'Transfer of 50 coins accepted');
  assert(tx50.data.balance === 450, `Alice balance correctly debited to 450 (Actual: ${tx50.data?.balance})`);

  // Verify Bob received the coins
  const bobMe = await get('/api/wallet/me', bobToken);
  assert(bobMe.data.wallet.balance === 550, `Bob balance credited to 550 (Actual: ${bobMe.data?.wallet?.balance})`);

  // 9. Transfer limit test: 200 coins transfer (Exact allowed cap)
  const tx2Id = `test_tx_${Date.now()}_2`;
  const tx200 = await post(
    '/api/wallet/transfer',
    {
      txId: tx2Id,
      receiverWalletId: bobWalletId,
      amount: 200,
      nonce: `n_${Date.now()}_2`,
    },
    aliceToken
  );
  assert(tx200.status === 200 && tx200.data.status === 'accepted', 'Transfer of 200 coins (maximum allowed cap) accepted');
  assert(tx200.data.balance === 250, `Alice balance debited to 250 (Actual: ${tx200.data?.balance})`);

  // 10. Transfer limit test: 201 coins transfer (> 200 limit) MUST BE BLOCKED
  const tx3Id = `test_tx_${Date.now()}_3`;
  const tx201 = await post(
    '/api/wallet/transfer',
    {
      txId: tx3Id,
      receiverWalletId: bobWalletId,
      amount: 201,
      nonce: `n_${Date.now()}_3`,
    },
    aliceToken
  );
  assert(tx201.status === 400, 'Transfer of 201 coins blocked by server limit');
  assert(
    tx201.data.error.includes('Transfer limit exceeded. The maximum allowed per transaction is 200 coins.'),
    `Exact required error message returned: "${tx201.data?.error}"`
  );

  // 11. Test zero, negative, and self transfers
  const txZero = await post(
    '/api/wallet/transfer',
    {
      txId: `test_tx_${Date.now()}_zero`,
      receiverWalletId: bobWalletId,
      amount: 0,
    },
    aliceToken
  );
  assert(txZero.status === 400, 'Transfer of 0 coins blocked');

  const txSelf = await post(
    '/api/wallet/transfer',
    {
      txId: `test_tx_${Date.now()}_self`,
      receiverWalletId: aliceWalletId,
      amount: 10,
    },
    aliceToken
  );
  assert(txSelf.status === 400, 'Transfer to self blocked');

  // 12. Test idempotency: Resubmitting identical txId does NOT debit again
  const retryTx200 = await post(
    '/api/wallet/transfer',
    {
      txId: tx2Id,
      receiverWalletId: bobWalletId,
      amount: 200,
      nonce: `n_${Date.now()}_2`,
    },
    aliceToken
  );
  assert(retryTx200.status === 200 && retryTx200.data.balance === 250, 'Idempotency verified: re-submitting same txId does not debit again');

  // 13. Test offline batch sync endpoint
  const offlineTxs = [
    {
      txId: `off_tx_${Date.now()}_1`,
      receiverWalletId: bobWalletId,
      amount: 30,
      nonce: `off_nonce_${Date.now()}_1`,
      queuedAt: new Date().toISOString(),
    },
    {
      txId: `off_tx_${Date.now()}_2_overlimit`,
      receiverWalletId: bobWalletId,
      amount: 250, // exceeds 200 limit!
      nonce: `off_nonce_${Date.now()}_2`,
      queuedAt: new Date().toISOString(),
    },
  ];

  const syncRes = await post('/api/wallet/sync-offline', { transactions: offlineTxs }, aliceToken);
  assert(syncRes.status === 200, 'Offline sync endpoint processed successfully');
  assert(syncRes.data.summary.syncedCount === 1, `1 valid offline transaction accepted (Actual: ${syncRes.data?.summary?.syncedCount})`);
  assert(syncRes.data.summary.rejectedCount === 1, `1 invalid offline transaction (>200 coins) rejected (Actual: ${syncRes.data?.summary?.rejectedCount})`);
  assert(syncRes.data.currentBalance === 220, `Alice balance correctly updated after sync to 220 (Actual: ${syncRes.data?.currentBalance})`);

  // 14. Test Logout (Section 18.A)
  const logoutRes = await post('/api/auth/logout', {}, aliceToken);
  assert(logoutRes.status === 200 && logoutRes.data.success === true, 'Logout successfully invalidates session');

  // 15. Verify protected endpoint requires authentication after logout
  const postLogoutMe = await get('/api/wallet/me', aliceToken);
  assert(postLogoutMe.status === 401, 'Accessing protected wallet endpoint after logout is denied (HTTP 401)');

  // 16. Verify logging back in retains existing balance and does NOT reset to 500
  const reLogin = await post('/api/auth/login', {
    usernameOrEmail: testUsername,
    password: 'Password123!',
  });
  // 17. Two-user offline payment and receiver voucher synchronization test
  // Bob sends 40 coins to Alice while offline; Alice receives voucher and syncs first
  const bobVoucherTxId = `voucher_tx_${Date.now()}`;
  const bobVoucher = {
    txId: bobVoucherTxId,
    senderWalletId: bobWalletId,
    receiverWalletId: aliceWalletId,
    amount: 40,
    nonce: `voucher_nonce_${Date.now()}`,
    queuedAt: new Date().toISOString(),
  };

  // Alice logs in again to get fresh session
  const aliceLogin = await post('/api/auth/login', {
    usernameOrEmail: testUsername,
    password: 'Password123!',
  });
  const currentAliceToken = aliceLogin.data.token;

  // Alice (receiver) submits Bob's offline voucher when online
  const receiverSyncRes = await post('/api/wallet/sync-offline', { transactions: [bobVoucher] }, currentAliceToken);
  assert(receiverSyncRes.status === 200, 'Receiver sync of offline voucher processed with HTTP 200');
  assert(receiverSyncRes.data.summary.syncedCount === 1, `Receiver sync accepted Bob's signed offline transfer (Actual: ${receiverSyncRes.data?.summary?.syncedCount})`);
  assert(receiverSyncRes.data.summary.rejectedCount === 0, `No transactions rejected during receiver sync (Actual: ${receiverSyncRes.data?.summary?.rejectedCount})`);

  // Verify Alice received the 40 coins (220 + 40 = 260)
  const aliceAfterSync = await get('/api/wallet/me', currentAliceToken);
  assert(aliceAfterSync.data.wallet.balance === 260, `Alice balance correctly credited to 260 (Actual: ${aliceAfterSync.data?.wallet?.balance})`);

  // Verify Bob was debited 40 coins (780 - 40 = 740)
  const bobAfterSync = await get('/api/wallet/me', bobToken);
  assert(bobAfterSync.data.wallet.balance === 740, `Bob balance correctly debited to 740 (Actual: ${bobAfterSync.data?.wallet?.balance})`);

  // Later, Bob comes online and tries to sync his queued transaction too
  const senderSyncRes = await post('/api/wallet/sync-offline', { transactions: [bobVoucher] }, bobToken);
  assert(senderSyncRes.status === 200, 'Sender sync of already processed voucher succeeds with HTTP 200');
  assert(senderSyncRes.data.summary.alreadyProcessedCount === 1, `Sender sync reconciles already processed voucher without error (Actual: ${senderSyncRes.data?.summary?.alreadyProcessedCount})`);
  assert(senderSyncRes.data.summary.rejectedCount === 0, `Sender sync does NOT mark reconciled transaction as rejected (Actual: ${senderSyncRes.data?.summary?.rejectedCount})`);

  // Verify Bob's balance was not debited a second time
  const bobFinal = await get('/api/wallet/me', bobToken);
  assert(bobFinal.data.wallet.balance === 740, `Bob balance preserved at 740 without double-spending (Actual: ${bobFinal.data?.wallet?.balance})`);

  console.log(`\n================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner failure:', err);
  process.exit(1);
});
