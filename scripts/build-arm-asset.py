"""Freeze the CC0 Blender scan as an unchanged, paintable arm GLB.

Run with Blender: blender -b -t 2 --python scripts/build-arm-asset.py --
  <right-arm-realistic-scan-vertical.blend> <landmarks.json>

Only rigid rotation, uniform scaling, triangle subdivision at UV/cut boundaries,
and a context-only cap are applied. No radial reconstruction deforms the scan.
"""
import array
import bisect
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
SCALE = 540 / LANDMARKS['source_shoulder_wrist_length_m']
TOP = 270.0
BOTTOM = -270.0
PROFILE_STEP = 5
ANGLE_STEPS = 256

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
mesh = obj.data
mesh.calc_loop_triangles()
sets = mesh.attributes['.sculpt_face_set']

def converted(v):
    # Rotate 180 degrees about Y: the original body's inside (+X) becomes -X.
    return Vector((-v[0] * SCALE, v[1] * SCALE, -v[2] * SCALE))

positions = [converted(v.co) for v in mesh.vertices]
normals = [Vector((-v.normal.x, v.normal.y, -v.normal.z)) for v in mesh.vertices]
base_triangles = []
for tri in mesh.loop_triangles:
    base_triangles.append((list(tri.vertices), sets.data[tri.polygon_index].value))

# The sole extracted boundary is the original nonplanar shoulder opening.
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
if len(boundary_edges) != 128 or any(len(v) != 2 for v in adjacency.values()):
    raise RuntimeError('Expected the original single 128-edge shoulder boundary.')
loop = [boundary_edges[0][0]]
previous = None
while True:
    candidates = adjacency[loop[-1]]
    following = candidates[0] if candidates[0] != previous else candidates[1]
    if following == loop[0]:
        break
    previous = loop[-1]
    loop.append(following)
cap_center = sum((positions[i] for i in loop), Vector()) / len(loop)
center_index = len(positions)
positions.append(cap_center)
normals.append(Vector((0, 1, 0)))
for edge in boundary_edges:
    a, b = edge_directions[edge]
    # Reverse the original border edge so cap normals point out of the body.
    base_triangles.append(([center_index, b, a], -1))

def plane_segments(y):
    segments = []
    for indices, _ in base_triangles:
        points = [positions[i] for i in indices]
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
    # The original arm contours are star-shaped around this centroid. Measure
    # cumulative contour length, rather than flattening equal angular sectors.
    polar = sorted((((math.atan2(z - cz, x - cx) - math.pi) % (2 * math.pi)), (x, z)) for x, z in contour)
    a = polar[-1][1]
    b = polar[0][1]
    t = (cz - a[1]) / (b[1] - a[1])
    seam = (a[0] + t * (b[0] - a[0]), cz)
    knots = [(0.0, seam)] + polar + [(2 * math.pi, seam)]
    lengths = [0.0]
    for i in range(1, len(knots)):
        lengths.append(lengths[-1] + math.dist(knots[i - 1][1], knots[i][1]))
    total = lengths[-1]
    cdf = []
    angles = [k[0] for k in knots]
    for step in range(ANGLE_STEPS + 1):
        angle = step / ANGLE_STEPS * 2 * math.pi
        right = min(len(knots) - 1, max(1, bisect.bisect_right(angles, angle)))
        left = right - 1
        ratio = (angle - angles[left]) / (angles[right] - angles[left])
        cdf.append((lengths[left] + ratio * (lengths[right] - lengths[left])) / total)
    return {'distance': TOP - y, 'circumference': circumference, 'center': [cx, cz], 'cdf': cdf, 'loops': len(loops)}

profiles = [cross_section(TOP - d) for d in range(0, 541, PROFILE_STEP)]

def uv_at(position):
    distance = min(540, max(0, TOP - position.y))
    left = min(len(profiles) - 2, int(distance // PROFILE_STEP))
    right = left + 1
    fraction = (distance - left * PROFILE_STEP) / PROFILE_STEP
    a, b = profiles[left], profiles[right]
    cx = a['center'][0] + fraction * (b['center'][0] - a['center'][0])
    cz = a['center'][1] + fraction * (b['center'][1] - a['center'][1])
    angle = ((math.atan2(position.z - cz, position.x - cx) - math.pi) % (2 * math.pi)) / (2 * math.pi)
    index = min(ANGLE_STEPS - 1, int(angle * ANGLE_STEPS))
    partial = angle * ANGLE_STEPS - index
    def row_u(row):
        return row['cdf'][index] + partial * (row['cdf'][index + 1] - row['cdf'][index])
    u = row_u(a) + fraction * (row_u(b) - row_u(a))
    return [u, (position.y + 270) / 540]

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
        if (triangle[1]['p'] - triangle[0]['p']).cross(triangle[2]['p'] - triangle[0]['p']).length > 1e-8:
            groups[group].append(triangle)

for indices, face_set in base_triangles:
    triangle = [{'p': positions[i].copy(), 'n': normals[i].copy(), 'uv': [0.0, 0.0]} for i in indices]
    # The original wrist face-set border is tilted. Its hand-base faces above
    # the horizontal wrist landmark are still wrist, not the displayed hand.
    if face_set not in {20, 11, 10}:
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
    if polygon and max(v['uv'][0] for v in polygon) - min(v['uv'][0] for v in polygon) > 0.5:
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
              'sourceObject': 'GEO-body_male_realistic', 'multiresolutionLevel': 2,
              'processing': 'Rigid rotation, uniform scale, shoulder context cap, UV seam triangle split; original scan surface retained.',
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
(assets / 'right-arm.glb').write_bytes(glb)
elbow_distance = round(TOP - LANDMARKS['vertical_coordinates']['elbow'][1] * SCALE)
profile_values = [[int(p['distance']), round(p['circumference'], 1)] for p in profiles]
metadata = {'length': 540, 'elbow': elbow_distance, 'shoulderY': TOP, 'wristY': BOTTOM,
            'sourceElbowDistanceMm': TOP - LANDMARKS['vertical_coordinates']['elbow'][1] * SCALE,
            'profileStepMm': PROFILE_STEP, 'sourceScaleMmPerMeter': SCALE, **provenance, 'statistics': statistics}
(assets / 'arm-profile.js').write_text('// Generated from horizontal intersections of the original CC0 scan mesh.\n'
    + 'export const armMetadata = Object.freeze(' + json.dumps(metadata, ensure_ascii=False, indent=2) + ');\n'
    + 'export const armCircumferences = ' + json.dumps(profile_values, separators=(',', ':')) + ';\n')
(assets / 'SOURCE.md').write_text('# Right-arm model source\n\n'
    + f'- Author: {LANDMARKS["author"]}\n- License: CC0 1.0 Universal ({LANDMARKS["license"]})\n'
    + f'- Official bundle: {LANDMARKS["source_url"]}\n- Official license information: {LANDMARKS["official_license_url"]}\n'
    + '- Original asset: `GEO-body_male_realistic`, evaluated at Multiresolution level 2.\n'
    + '- Selected original sculpt face sets: 20 (upper arm), 11 (forearm), 10 and 84–103 (hand/fingers).\n'
    + '- The artist scan surface is retained. Processing consists of uniform scaling, rigid rotation, a cap over the original shoulder opening, and triangle subdivision at paint/UV boundaries.\n'
    + '- Shoulder-to-wrist reference landmark distance is set to 540 mm. Hand/fingers and the shoulder cap are display context only.\n'
    + '- Circumferences are measured from horizontal mesh intersections every 5 mm and used for an approximate wrap stencil. This is not an individual body measurement or an exact developable surface.\n')
print(json.dumps({'glbBytes': len(glb), 'metadata': metadata, 'circumferenceRange': [min(p[1] for p in profile_values), max(p[1] for p in profile_values)]}, indent=2))
