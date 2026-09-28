"""Regenerate the inner-corner block, its single bone-visibility model and item.

One geometry holds a cable-sized center per face and an arm per face and tangent
direction. Block states choose what is visible:

* starstone:face_mask_low/high - the active faces (bit order FACE_NAMES);
* starstone:arms_low/high - external arms, one fixed bit per (face, direction)
  from ARM_BIT (kept in sync with scripts/innerCorner.js by the tests).

An arm whose direction ends in another active face's support is the internal
bend and is visible whenever both faces are. Otherwise the arm needs its bit.
Model X mirrors world X, as for the ordinary cable (see cableVisual tests).
"""
import json
from pathlib import Path

BP = Path(__file__).resolve().parents[1] / 'starstone_bp'
RP = Path(__file__).resolve().parents[1] / 'starstone_rp'
FACES = {'up': (0,1,0), 'down': (0,-1,0), 'north': (0,0,-1),
         'south': (0,0,1), 'east': (1,0,0), 'west': (-1,0,0)}
FACE_NAMES = list(FACES)
ARM_BIT = {
    'up': {'north':0,'south':1,'east':2,'west':3},
    'down': {'north':4,'south':5,'east':6,'west':7},
    'north': {'up':6,'down':3,'east':1,'west':5},
    'south': {'up':7,'down':2,'east':4,'west':0},
    'east': {'up':5,'down':0,'north':7,'south':3},
    'west': {'up':4,'down':1,'north':2,'south':6},
}
# Model face names whose normal lies on each axis, and the axis their U runs on.
AXIS_FACES = {0: ('east','west'), 1: ('up','down'), 2: ('north','south')}
U_AXIS = {0: 2, 1: 0, 2: 0}

def axis_of(vector):
    return next(i for i,v in enumerate(vector) if v)

def opposite(face):
    return next(f for f,n in FACES.items() if all(a == -b for a,b in zip(n, FACES[face])))

def perpendicular(a, b):
    return sum(x*y for x,y in zip(FACES[a],FACES[b])) == 0

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

def cube(lo, hi, uv):
    """Axis-aligned cube from cell-centered world bounds (-8..8 on every axis)."""
    return {'origin': [round(-hi[0], 4), round(lo[1] + 8, 4), round(lo[2], 4)],
            'size': [round(h - l, 4) for l,h in zip(lo, hi)], 'uv': uv}

def shell(face):
    """The cable's 0.02..0.14 shell just off the support plane of `face`."""
    normal = FACES[face]
    axis = axis_of(normal)
    sign = normal[axis]
    ends = sorted((-8*sign + .02*sign, -8*sign + .14*sign))
    return axis, ends

def uvs(surface_axis, surface, sides, rotation=0):
    """Surface faces get `surface`; the four thin sides get `sides`."""
    result = {}
    for axis, names in AXIS_FACES.items():
        for name in names:
            entry = dict(surface if axis == surface_axis else sides)
            if axis == surface_axis and rotation:
                entry['uv_rotation'] = rotation
            result[name] = entry
    return result

HUB_TOP = {'uv': [13,13], 'uv_size': [6,6], 'material_instance': 'hub'}
HUB_SIDE = {'uv': [19,14], 'uv_size': [5,2], 'material_instance': 'hub'}
ARM_TOP = {'uv': [19,14], 'uv_size': [5,4]}
ARM_SIDE = {'uv': [19,14], 'uv_size': [5,2]}

def center(face):
    axis, ends = shell(face)
    lo, hi = [-2.0]*3, [2.0]*3
    lo[axis], hi[axis] = ends
    return cube(lo, hi, uvs(axis, HUB_TOP, HUB_SIDE))

def arm(face, toward):
    axis, ends = shell(face)
    direction = FACES[toward]
    along = axis_of(direction)
    lo, hi = [-1.0]*3, [1.0]*3
    lo[axis], hi[axis] = ends
    lo[along], hi[along] = (2.0, 8.14) if direction[along] > 0 else (-8.14, -2.0)
    rotation = 0 if U_AXIS[axis] == along else 90
    return cube(lo, hi, uvs(axis, ARM_TOP, ARM_SIDE, rotation))

def any_of(state, values):
    return '(' + ' || '.join(f"query.block_state('{state}') == {v}" for v in values) + ')'

def face_active(face):
    index = FACE_NAMES.index(face)
    if index < 4:
        return any_of('starstone:face_mask_low', [v for v in range(16) if v & (1 << index)])
    return any_of('starstone:face_mask_high', [v for v in range(4) if v & (1 << (index-4))])

def arm_bit(bit):
    state = 'starstone:arms_low' if bit < 4 else 'starstone:arms_high'
    return any_of(state, [v for v in range(16) if v & (1 << (bit % 4))])

bones, visibility = [], {}
for face in FACE_NAMES:
    name = f'center_{face}'
    bones.append({'name': name, 'pivot': [0,0,0], 'cubes': [center(face)]})
    visibility[name] = face_active(face)
for face in FACE_NAMES:
    for toward in FACE_NAMES:
        if not perpendicular(face, toward):
            continue
        name = f'arm_{face}_{toward}'
        bones.append({'name': name, 'pivot': [0,0,0], 'cubes': [arm(face, toward)]})
        visibility[name] = (f'{face_active(face)} && ({face_active(opposite(toward))} || '
                            f'{arm_bit(ARM_BIT[face][toward])})')

write(RP/'models/blocks/starstone_inner_corner.geo.json',
      {'format_version':'1.21.0','minecraft:geometry':[{
          'description':{'identifier':'geometry.starstone_inner_corner',
              'texture_width':32,'texture_height':32,'visible_bounds_width':2,
              'visible_bounds_height':2,'visible_bounds_offset':[0,.5,0]},
          'bones':bones}]})

def material(state):
    base = {'render_method':'alpha_test','face_dimming':False,'ambient_occlusion':False}
    return {'*': {'texture': f'starstone:cable_arm_{state}', **base},
            'hub': {'texture': f'starstone:cable_hub_{state}', **base}}

block={'format_version':'1.21.120','minecraft:block':{
    'description':{'identifier':'starstone:inner_corner',
        'menu_category':{'category':'none'},
        'states':{'starstone:face_mask_low':list(range(16)),
                  'starstone:face_mask_high':list(range(4)),
                  'starstone:arms_low':list(range(16)),
                  'starstone:arms_high':list(range(16)),
                  'starstone:powered':[False,True]}},
    'components':{'minecraft:selection_box':{'origin':[-8,0,-8],'size':[16,16,16]},
        'minecraft:collision_box':False,'minecraft:map_color':[30,40,60],
        'minecraft:destructible_by_mining':{'seconds_to_destroy':.5},
        'minecraft:loot':'loot_tables/blocks/inner_corner.json',
        'minecraft:geometry':{'identifier':'geometry.starstone_inner_corner',
                              'bone_visibility':visibility},
        'minecraft:material_instances':material('off'),
        'starstone:inner_corner':{},'minecraft:movable':{'movement_type':'immovable'},
        'minecraft:light_emission':0},
    'permutations':[
        {'condition':"query.block_state('starstone:powered') == true",
         'components':{'minecraft:material_instances':material('on'),
                       'minecraft:light_emission':1}}]}}
write(BP/'blocks/inner_corner.json',block)
write(BP/'items/inner_corner_item.json',{'format_version':'1.21.120','minecraft:item':{
    'description':{'identifier':'starstone:inner_corner_item','menu_category':{'category':'items'}},
    'components':{'minecraft:max_stack_size':64,'minecraft:icon':'starstone_inner_corner',
        'minecraft:block_placer':{'block':'starstone:inner_corner'},
        'minecraft:display_name':{'value':'item.starstone:inner_corner_item'}}}})
write(BP/'loot_tables/blocks/inner_corner.json',{'format_version':'1.0.0','pools':[
    {'name':'main','rolls':1,'entries':[{'type':'item','name':'starstone:inner_corner_item'}]}]})
write(BP/'recipes/inner_corner.json',{'format_version':'1.20.10','minecraft:recipe_shaped':{
    'description':{'identifier':'starstone:inner_corner_recipe'},'tags':['crafting_table'],
    'unlock':[{'item':'starstone:cable_item'}],'pattern':['C ',' C'],
    'key':{'C':{'item':'starstone:cable_item'}},
    'result':{'item':'starstone:inner_corner_item','count':1}}})
