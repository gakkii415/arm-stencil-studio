"""Freeze a CC0 Blender scan part as an unchanged, paintable GLB.

Run with Blender: blender -b -t 2 --python scripts/build-model-asset.py --
  <part-vertical.blend> <part-metadata.json> <sex-part>

Only rigid rotation, uniform scaling, triangle subdivision at UV/cut boundaries,
and a context-only cap are applied. No radial reconstruction deforms the scan.
"""
import array
import bpy
import collections
import json
import math
import pathlib
import struct
import sys
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[1]
ARGS = sys.argv[sys.argv.index('--') + 1:]
SOURCE = pathlib.Path(ARGS[0])
LANDMARKS = json.loads(pathlib.Path(ARGS[1]).read_text())
MODEL_ID = ARGS[2]
SEX, PART = MODEL_ID.split('-', 1)
FLAT = PART in {'back', 'chest', 'abdomen'}
LENGTH = LANDMARKS.get('target_length_mm', 550 if FLAT else (800 if PART == 'leg' else 540))
REFERENCE_LENGTH = LANDMARKS.get('reference_length_m', LANDMARKS.get('source_shoulder_wrist_length_m'))
vertical_landmarks = LANDMARKS['vertical_coordinates']
source_top = vertical_landmarks.get('top', vertical_landmarks.get('shoulder'))
source_bottom = vertical_landmarks.get('bottom', vertical_landmarks.get('wrist'))
SOURCE_CENTER_Y = (source_top[1] + source_bottom[1]) / 2
SCALE = LENGTH / (source_top[1] - source_bottom[1])
TOP = LENGTH / 2
BOTTOM = -TOP
PAINT_SETS = set(LANDMARKS.get('paint_face_sets', [20, 11, 10] if PART == 'arm' else []))
if PART == 'arm':
    PAINT_SETS.add(10)  # tilted wrist border, above the horizontal wrist only
elif PART == 'leg':
    PAINT_SETS.add(13)  # tilted ankle border, above the horizontal ankle only
PROFILE_STEP = 5

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
mesh = obj.data
mesh.calc_loop_triangles()
sets = mesh.attributes['.sculpt_face_set']
paint_mask = mesh.attributes.get(LANDMARKS.get('paint_face_attribute', 'stencil_paintable'))
allowed_triangles = {}

def converted(v):
    # Rotate 180 degrees about Y: the original body's inside (+X) becomes -X.
    return Vector((-v[0] * SCALE, (v[1] - SOURCE_CENTER_Y) * SCALE, -v[2] * SCALE))

positions = [converted(v.co) for v in mesh.vertices]
normals = [Vector((-v.normal.x, v.normal.y, -v.normal.z)) for v in mesh.vertices]
base_triangles = []
for tri in mesh.loop_triangles:
    base_triangles.append((list(tri.vertices), sets.data[tri.polygon_index].value))
    allowed_triangles[tuple(tri.vertices)] = bool(paint_mask.data[tri.polygon_index].value) if paint_mask else True

# Close each original extraction opening with a context-only outward fan.
edge_counts = collections.Counter()
edge_directions = {}
for polygon in mesh.polygons:
    for i, a in enumerate(polygon.vertices):
        b = polygon.vertices[(i + 1) % len(polygon.vertices)]
        edge = tuple(sorted((a, b)))
        edge_counts[edge] += 1
        edge_directions[edge] = (a, b)
boundary_edges = [edge for edge, count in edge_counts.items() if count == 1]
adjacency = collections.defaultdict(list)
for a, b in boundary_edges:
    adjacency[a].append(b)
    adjacency[b].append(a)
if any(len(v) != 2 for v in adjacency.values()):
    raise RuntimeError('Extraction boundary must contain disjoint closed loops.')
remaining_boundary = set(adjacency)
cap_loops = []
while remaining_boundary:
    loop = [next(iter(remaining_boundary))]
    previous = None
    while True:
        candidates = adjacency[loop[-1]]
        following = candidates[0] if candidates[0] != previous else candidates[1]
        if following == loop[0]:
            break
        previous = loop[-1]
        loop.append(following)
    remaining_boundary.difference_update(loop)
    cap_loops.append(loop)
    cap_center = sum((positions[i] for i in loop), Vector()) / len(loop)
    center_index = len(positions)
    positions.append(cap_center)
    normals.append(Vector((0, 1, 0)))
    for i, a in enumerate(loop):
        b = loop[(i + 1) % len(loop)]
        source_a, source_b = edge_directions[tuple(sorted((a, b)))]
        base_triangles.append(([center_index, source_b, source_a], -1))

triangle_bins = collections.defaultdict(list)
if not FLAT:
    for indices, _ in base_triangles:
        points = [positions[i] for i in indices]
        first = max(0, math.floor((TOP - max(p.y for p in points)) / PROFILE_STEP))
        last = min(math.ceil(LENGTH / PROFILE_STEP), math.floor((TOP - min(p.y for p in points)) / PROFILE_STEP))
        for index in range(first, last + 1):
            triangle_bins[index].append(points)

def plane_segments(y):
    segments = []
    for points in triangle_bins[math.floor((TOP - y) / PROFILE_STEP)]:
        if min(p.y for p in points) > y or max(p.y for p in points) < y:
            continue
        cuts = []
        for i, a in enumerate(points):
            b = points[(i + 1) % 3]
            if (a.y <= y < b.y) or (b.y <= y < a.y):
                t = (y - a.y) / (b.y - a.y)
                # Python double precision keeps opposite traversals of a
                # shared edge coincident even beside the shoulder fan center.
                cuts.append((a.x + t * (b.x - a.x), a.z + t * (b.z - a.z)))
        if len(cuts) == 2:
            segments.append(cuts)
    return segments

def cross_section(y):
    segments = plane_segments(y)
    vertices = {}
    edges = collections.defaultdict(list)
    buckets = collections.defaultdict(list)
    def key(p):
        bucket = (math.floor(p[0] / 0.001), math.floor(p[1] / 0.001))
        for dx in [-1, 0, 1]:
            for dz in [-1, 0, 1]:
                for candidate in buckets[(bucket[0] + dx, bucket[1] + dz)]:
                    if math.dist(vertices[candidate], p) < 1e-7:
                        return candidate
        result = len(vertices)
        vertices[result] = p
        buckets[bucket].append(result)
        return result
    unused = set()
    for a, b in segments:
        ka, kb = key(a), key(b)
        if ka == kb:
            continue
        edge = tuple(sorted((ka, kb)))
        if edge in unused:
            continue
        unused.add(edge)
        edges[ka].append(kb)
        edges[kb].append(ka)
    loops = []
    while unused:
        first, following = next(iter(unused))
        path = [first]
        previous = first
        current = following
        unused.remove(tuple(sorted((first, following))))
        while current != first:
            path.append(current)
            options = [n for n in edges[current] if tuple(sorted((current, n))) in unused]
            if not options:
                raise RuntimeError(f'Open cross section at y={y}: {len(path)} segments')
            following = options[0]
            unused.remove(tuple(sorted((current, following))))
            previous, current = current, following
        points = [vertices[k] for k in path]
        length = sum(math.dist(points[i], points[(i + 1) % len(points)]) for i in range(len(points)))
        loops.append((length, points))
    if not loops:
        raise RuntimeError(f'No arm contour at y={y}')
    circumference, contour = max(loops, key=lambda item: item[0])
    # Polygon centroid, independent of mesh density.
    area2 = cx = cz = 0.0
    for i, a in enumerate(contour):
        b = contour[(i + 1) % len(contour)]
        cross = a[0] * b[1] - b[0] * a[1]
        area2 += cross
        cx += (a[0] + b[0]) * cross
        cz += (a[1] + b[1]) * cross
    cx /= 3 * area2
    cz /= 3 * area2
    # Keep connected contour order. Shoulder/hip concavities need not be
    # star-shaped, so angular sorting would fold UVs over those source surfaces.
    if area2 < 0:
        contour.reverse()
    seam_candidates = []
    for index, a in enumerate(contour):
        b = contour[(index + 1) % len(contour)]
        if (a[1] <= cz < b[1]) or (b[1] <= cz < a[1]):
            fraction = (cz - a[1]) / (b[1] - a[1])
            x = a[0] + fraction * (b[0] - a[0])
            if x < cx:
                seam_candidates.append((x, index, (x, cz)))
    if not seam_candidates:
        raise RuntimeError('No body-facing contour seam.')
    _, seam_index, seam = min(seam_candidates)
    knots = [seam] + [contour[(seam_index + 1 + i) % len(contour)] for i in range(len(contour))] + [seam]
    lengths = [0.0]
    for i in range(1, len(knots)):
        lengths.append(lengths[-1] + math.dist(knots[i - 1], knots[i]))
    return {'distance': TOP - y, 'circumference': circumference, 'center': [cx, cz], 'knots': knots, 'lengths': lengths, 'loops': len(loops)}

profiles = [] if FLAT else [cross_section(TOP - d) for d in range(0, int(LENGTH) + 1, PROFILE_STEP)]
if profiles and profiles[-1]['distance'] < LENGTH:
    profiles.append(cross_section(BOTTOM))

if FLAT:
    flat_positions = []
    for indices, face_set in base_triangles:
        if face_set == -1 or not allowed_triangles.get(tuple(indices), False):
            continue
        vertices = [positions[i] for i in indices]
        for bound, keep_lower in [(TOP, True), (BOTTOM, False)]:
            clipped = []
            for i, a in enumerate(vertices):
                b = vertices[(i + 1) % len(vertices)]
                inside_a = a.y <= bound if keep_lower else a.y >= bound
                inside_b = b.y <= bound if keep_lower else b.y >= bound
                if inside_a:
                    clipped.append(a)
                if inside_a != inside_b:
                    clipped.append(a.lerp(b, (bound - a.y) / (b.y - a.y)))
            vertices = clipped
            if not vertices:
                break
        flat_positions.extend(p.x for p in vertices)
    if not flat_positions:
        raise RuntimeError('No posterior source surface for flat stencil.')
    FLAT_LEFT = min(flat_positions)
    FLAT_RIGHT = max(flat_positions)
    FLAT_WIDTH = FLAT_RIGHT - FLAT_LEFT
    FLAT_CENTER_X = (FLAT_LEFT + FLAT_RIGHT) / 2
    for position in positions:
        position.x -= FLAT_CENTER_X
    FLAT_LEFT = -FLAT_WIDTH / 2
    FLAT_RIGHT = FLAT_WIDTH / 2

def uv_at(position):
    if FLAT:
        return [(position.x - FLAT_LEFT) / FLAT_WIDTH, (position.y - BOTTOM) / LENGTH]
    position_key = tuple(position)
    if position_key in uv_cache:
        return uv_cache[position_key].copy()
    y = min(TOP, max(BOTTOM, position.y))
    key = round(y, 6)
    if key not in exact_sections:
        exact_sections[key] = cross_section(y)
        if len(exact_sections) > 128:
            exact_sections.popitem(last=False)
    section = exact_sections[key]
    best_distance = math.inf
    u = 0
    for index in range(len(section['knots']) - 1):
        a, b = section['knots'][index:index + 2]
        dx, dz = b[0] - a[0], b[1] - a[1]
        length2 = dx * dx + dz * dz
        if length2 == 0:
            continue
        fraction = min(1, max(0, ((position.x - a[0]) * dx + (position.z - a[1]) * dz) / length2))
        error = (position.x - a[0] - fraction * dx) ** 2 + (position.z - a[1] - fraction * dz) ** 2
        if error < best_distance:
            best_distance = error
            u = (section['lengths'][index] + fraction * math.sqrt(length2)) / section['lengths'][-1]
    result = [u, (position.y - BOTTOM) / LENGTH]
    uv_cache[position_key] = result
    return result.copy()

exact_sections = collections.OrderedDict()
uv_cache = {}

def interpolate_vertex(a, b, t):
    return {'p': a['p'].lerp(b['p'], t), 'n': a['n'].lerp(b['n'], t).normalized(),
            'uv': [a['uv'][i] + t * (b['uv'][i] - a['uv'][i]) for i in range(2)]}

def clip(polygon, coordinate, bound, keep_lower):
    if not polygon:
        return []
    result = []
    for i, a in enumerate(polygon):
        b = polygon[(i + 1) % len(polygon)]
        av, bv = coordinate(a), coordinate(b)
        inside_a = av <= bound if keep_lower else av >= bound
        inside_b = bv <= bound if keep_lower else bv >= bound
        if inside_a:
            result.append(a)
        if inside_a != inside_b:
            result.append(interpolate_vertex(a, b, (bound - av) / (bv - av)))
    return result

groups = {'paintable': [], 'context': []}
def append_polygon(group, polygon):
    for i in range(1, len(polygon) - 1):
        triangle = [polygon[0], polygon[i], polygon[i + 1]]
        face_normal = (triangle[1]['p'] - triangle[0]['p']).cross(triangle[2]['p'] - triangle[0]['p'])
        if face_normal.length > 1e-8:
            if group == 'context' and face_normal.dot(sum((v['n'] for v in triangle), Vector())) <= 0:
                # Multires scan wrinkles can disagree with a smoothed vertex
                # normal. Repair shading locally without moving any vertex.
                outward = face_normal.normalized()
                triangle = [{'p': v['p'].copy(), 'n': outward.copy(), 'uv': v['uv'].copy()} for v in triangle]
            groups[group].append(triangle)

for indices, face_set in base_triangles:
    triangle = [{'p': positions[i].copy(), 'n': normals[i].copy(), 'uv': [0.0, 0.0]} for i in indices]
    # The original wrist face-set border is tilted. Its hand-base faces above
    # the horizontal wrist landmark are still wrist, not the displayed hand.
    surface_allowed = face_set != -1 and (allowed_triangles.get(tuple(indices), False) if FLAT else face_set in PAINT_SETS)
    if not surface_allowed:
        if face_set == -1:
            face_normal = (triangle[1]['p'] - triangle[0]['p']).cross(triangle[2]['p'] - triangle[0]['p']).normalized()
            for vertex in triangle:
                vertex['n'] = face_normal
        append_polygon('context', triangle)
        continue
    append_polygon('context', clip(triangle, lambda v: v['p'].y, TOP, False))
    append_polygon('context', clip(triangle, lambda v: v['p'].y, BOTTOM, True))
    polygon = clip(clip(triangle, lambda v: v['p'].y, TOP, True), lambda v: v['p'].y, BOTTOM, False)
    for vertex in polygon:
        vertex['uv'] = uv_at(vertex['p'])
    if not FLAT and polygon and max(v['uv'][0] for v in polygon) - min(v['uv'][0] for v in polygon) > 0.5:
        for vertex in polygon:
            if vertex['uv'][0] < 0.5:
                vertex['uv'][0] += 1
        before = clip(polygon, lambda v: v['uv'][0], 1, True)
        after = clip(polygon, lambda v: v['uv'][0], 1, False)
        for vertex in after:
            vertex['uv'][0] -= 1
        append_polygon('paintable', before)
        append_polygon('paintable', after)
    else:
        append_polygon('paintable', polygon)

binary = bytearray()
views = []
accessors = []
def add_accessor(values, kind, component_type, target):
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    code = 'f' if component_type == 5126 else 'I'
    packed = array.array(code, values)
    if sys.byteorder != 'little':
        packed.byteswap()
    binary.extend(packed.tobytes())
    view_index = len(views)
    views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset, 'target': target})
    size = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[kind]
    accessor = {'bufferView': view_index, 'componentType': component_type, 'count': len(values) // size, 'type': kind}
    if kind == 'VEC3' and target == 34962:
        accessor['min'] = [min(values[i::size]) for i in range(size)]
        accessor['max'] = [max(values[i::size]) for i in range(size)]
    accessors.append(accessor)
    return len(accessors) - 1

gltf_meshes = []
statistics = {}
for name, triangles in groups.items():
    lookup = {}
    pos = []
    norm = []
    uv = []
    indices = []
    for triangle in triangles:
        for vertex in triangle:
            values = (*vertex['p'], *vertex['n'], *vertex['uv'])
            key = tuple(round(v, 7) for v in values)
            if key not in lookup:
                lookup[key] = len(pos) // 3
                pos.extend(vertex['p'])
                norm.extend(vertex['n'])
                uv.extend(vertex['uv'])
            indices.append(lookup[key])
    primitive = {'attributes': {'POSITION': add_accessor(pos, 'VEC3', 5126, 34962),
                                'NORMAL': add_accessor(norm, 'VEC3', 5126, 34962),
                                'TEXCOORD_0': add_accessor(uv, 'VEC2', 5126, 34962)},
                 'indices': add_accessor(indices, 'SCALAR', 5125, 34963), 'material': 0 if name == 'paintable' else 1, 'mode': 4}
    gltf_meshes.append({'name': name, 'primitives': [primitive]})
    statistics[name] = {'vertices': len(pos) // 3, 'triangles': len(indices) // 3}

provenance = {'author': LANDMARKS['author'], 'license': LANDMARKS['license'], 'source': LANDMARKS['source_url'],
              'sourceObject': LANDMARKS.get('source_object', f'GEO-body_{SEX}_realistic'), 'multiresolutionLevel': 2,
              'processing': 'Rigid rotation/translation, uniform scale, context boundary caps, paint and UV triangle split; original scan surface retained.',
              'units': 'mm', 'front': '-Z', 'insideSeam': '-X'}
gltf = {'asset': {'version': '2.0', 'generator': 'Arm stencil scan-preserving asset builder', 'extras': provenance},
        'scene': 0, 'scenes': [{'nodes': [0, 1]}],
        'nodes': [{'name': name, 'mesh': i, 'extras': {'paintable': name == 'paintable'}} for i, name in enumerate(groups)],
        'meshes': gltf_meshes,
        'materials': [{'name': 'paintable', 'pbrMetallicRoughness': {'baseColorFactor': [0.76, 0.55, 0.41, 1], 'metallicFactor': 0, 'roughnessFactor': 0.75}, 'doubleSided': True},
                      {'name': 'context', 'pbrMetallicRoughness': {'baseColorFactor': [0.64, 0.45, 0.33, 1], 'metallicFactor': 0, 'roughnessFactor': 0.8}, 'doubleSided': True}],
        'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'accessors': accessors}
json_bytes = json.dumps(gltf, separators=(',', ':')).encode()
while len(json_bytes) % 4:
    json_bytes += b' '
while len(binary) % 4:
    binary.append(0)
length = 12 + 8 + len(json_bytes) + 8 + len(binary)
glb = struct.pack('<4sII', b'glTF', 2, length) + struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes + struct.pack('<I4s', len(binary), b'BIN\0') + binary
assets = ROOT / 'assets'
assets.mkdir(exist_ok=True)
(assets / f'{MODEL_ID}.glb').write_bytes(glb)
split_position = LANDMARKS['vertical_coordinates'].get('split')
split_distance = None if FLAT or split_position is None else round(TOP - (split_position[1] - SOURCE_CENTER_Y) * SCALE)
profile_values = [[round(p['distance'], 3), round(p['circumference'], 1)] for p in profiles]
metadata = {'id': MODEL_ID, 'sex': SEX, 'part': PART, 'type': 'flat' if FLAT else 'wrap',
            'length': LENGTH, 'split': split_distance, 'topY': TOP, 'bottomY': BOTTOM,
            'width': FLAT_WIDTH if FLAT else None, 'sourceHorizontalTranslationMm': -FLAT_CENTER_X if FLAT else 0,
            'sourceSplitDistanceMm': None if split_position is None else TOP - (split_position[1] - SOURCE_CENTER_Y) * SCALE,
            'sourceVerticalTranslationBeforeScaleM': -SOURCE_CENTER_Y,
            'profileStepMm': PROFILE_STEP, 'sourceScaleMmPerMeter': SCALE, **provenance, 'statistics': statistics}
(assets / f'{MODEL_ID}-profile.js').write_text('// Generated from the original CC0 scan surface.\n'
    + 'export const modelMetadata = Object.freeze(' + json.dumps(metadata, ensure_ascii=False, indent=2) + ');\n'
    + 'export const modelCircumferences = ' + json.dumps(profile_values, separators=(',', ':')) + ';\n')
print(json.dumps({'glbBytes': len(glb), 'metadata': metadata,
                  'circumferenceRange': [min(p[1] for p in profile_values), max(p[1] for p in profile_values)] if profiles else None}, indent=2))
