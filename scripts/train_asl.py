"""Train the built-in ASL fingerspelling model (A-Z) for Sayn.

Data: 36,402 MediaPipe hand-landmark samples from AkramOM606/American-Sign-Language-Detection (MIT).
Features match the app: 21 (x, y) points in pixels, relative to the wrist, divided by the largest absolute value.
Output: www/asl/letters.json with MLP weights the app runs in plain JavaScript.
"""
import csv, json, sys, numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.model_selection import train_test_split

src, poses_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
rows = [[v for v in r if v.strip()] for r in csv.reader(open(src))]
rows = [r for r in rows if len(r) == 43]
y = np.array([int(r[0]) for r in rows]); X = np.array([[float(v) for v in r[1:]] for r in rows], dtype=np.float32)
labels = [chr(65 + i) for i in range(26)]
rng = np.random.default_rng(7)

def renorm(P):
    P = P - P[:, :1, :]
    m = np.abs(P.reshape(len(P), -1)).max(1)[:, None, None]
    return (P / np.maximum(m, 1e-6)).reshape(len(P), -1)

def augment(X, y, n=2):
    P = X.reshape(-1, 21, 2); outX, outy = [X], [y]
    for _ in range(n):
        a = rng.uniform(-0.3, 0.3, len(P))  # +-17 degrees
        R = np.stack([np.stack([np.cos(a), -np.sin(a)], 1), np.stack([np.sin(a), np.cos(a)], 1)], 1)
        Q = np.einsum('nij,nkj->nki', R, P)
        Q[:, :, 0] *= rng.uniform(0.85, 1.15, (len(P), 1))  # aspect jitter
        Q += rng.normal(0, 0.025, Q.shape)
        outX.append(renorm(Q)); outy.append(y)
    M = P.copy(); M[:, :, 0] *= -1  # other hand
    outX.append(renorm(M)); outy.append(y)
    return np.concatenate(outX).astype(np.float32), np.concatenate(outy)

Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.15, random_state=0, stratify=y)
Xa, ya = augment(Xtr, ytr)
clf = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-4, batch_size=256, max_iter=60, early_stopping=True, random_state=0)
clf.fit(Xa, ya)
acc = clf.score(Xte, yte)
Mte = Xte.reshape(-1, 21, 2).copy(); Mte[:, :, 0] *= -1
acc_m = clf.score(renorm(Mte), yte)
print(f'held-out accuracy {acc:.3f} | mirrored (other hand) {acc_m:.3f}')

# Sanity check against independently hand-authored letter poses from the sign-language-overlay project.
hits = 0; tested = []
for L in 'abcdefghiklouvwy':
    try: j = json.load(open(f'{poses_dir}/{L}.json'))['joints']
    except Exception: continue
    order = ['wrist','thumb_cmc','thumb_mcp','thumb_ip','thumb_tip','index_mcp','index_pip','index_dip','index_tip','middle_mcp','middle_pip','middle_dip','middle_tip','ring_mcp','ring_pip','ring_dip','ring_tip','pinky_mcp','pinky_pip','pinky_dip','pinky_tip']
    P = np.array([[j[k][0], j[k][1]] for k in order])[None]
    for flip in (False, True):
        Q = P.copy()
        if flip: Q[:, :, 0] *= -1
        p = labels[clf.predict(renorm(Q))[0]]
        if p == L.upper(): hits += 1; break
    tested.append((L.upper(), p))
print(f'hand-authored poses recognised: {hits}/{len(tested)}', tested)

json.dump({'labels': labels, 'acc': round(acc, 4), 'source': 'AkramOM606/American-Sign-Language-Detection (MIT)',
           'W': [w.round(5).tolist() for w in clf.coefs_], 'b': [b.round(5).tolist() for b in clf.intercepts_]}, open(out, 'w'), separators=(',', ':'))
print('wrote', out)
