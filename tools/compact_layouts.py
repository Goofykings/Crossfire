"""Authored metre-scale routes for small public matches; no model scaling/mirroring.

These rectangles feed the existing lot, facade, interior and PBR exporters.
Covered rectangles deliberately replace street portions with real through-buildings.
"""


def town(A):
    """European Town, 2026-11 overhaul: an irregular Piazza del Pozzo around the well, the raised
    Borgo Alto to the north-east, market, garden and bakers' quarters joined by winding lanes,
    covered arches and a cellar passage beneath the square's west wing. The perimeter lanes
    form two broken arcs rather than a ring road."""
    specs = [
        # Piazza del Pozzo: an irregular square opening north-east to the grand steps.
        ('square', 'plaza', [-7, -5, 7, 4]),
        ('square_ne', 'plaza', [7, -5, 11, 1]),
        ('square_west', 'plaza', [-10, -2, -7, 4]),
        ('square_north', 'street', [-1, -9, 3, -5]),
        # Borgo Alto: a raised piazzetta reached by the grand steps, Via Alta and the east lane.
        ('upper_town', 'terrace', [6, -21, 20, -10], {'height': 1.26}),
        ('grand_steps', 'street', [7, -10, 11, -5]),
        ('via_alta', 'street', [-5, -21, 6, -17]),
        ('via_alta_s', 'street', [-1, -17, 3, -9]),
        ('north_lane_e', 'street', [-14, -24, -1, -21]),
        ('north_lane_w', 'street', [-25, -25, -11, -22]),
        ('east_lane', 'street', [20, -15, 24, -2]),
        ('east_lane_m', 'street', [20, -2, 24, 8]),
        # Market quarter: the cellar portal stands in the court's north-east corner.
        ('market', 'court', [-19, -16, -9, -8]),
        # The market's north gate and the garden's south gate are covered passages.
        ('market_gate', 'passage', [-19, -22, -15, -16]),
        ('market_e', 'street', [-9, -11, -1, -8]),
        ('market_s', 'street', [-17, -8, -13, -4]),
        # The west lane ends at the west-yard link instead of running the map's height.
        ('west_lane', 'street', [-26, -22, -23, 3]),
        # A real shop links the west lane to the market without the exposed square.
        ('market_room', 'room', [-23, -14, -19, -11], {'lot': [-23, -16, -19, -8]}),
        # West yard: market, square (through an arch) and garden meet here.
        ('west_yard', 'court', [-20, -4, -13, 4]),
        ('west_arch', 'passage', [-13, 0, -10, 3]),
        ('west_link', 'street', [-23, 0, -20, 3]),
        # Garden quarter with the two-storey provisions house on its east side.
        ('garden', 'court', [-20, 9, -12, 16]),
        ('garden_n', 'street', [-20, 4, -17, 9]),
        ('garden_gate', 'passage', [-16, 16, -13, 20]),
        ('provisions_room', 'room', [-12, 9, -5, 12], {'lot': [-12, 4, -5, 13]}),
        # Cistern court: the second cellar portal, at the square's south-west corner.
        ('cistern_court', 'court', [-5, 4, 2, 14]),
        # South edge: two separate streets; the cistern court and south lane join them, so no
        # lane runs the map's width and the perimeter is not a ring road.
        ('south_west', 'street', [-24, 20, -2, 24]),
        ('south_link', 'street', [-5, 14, -2, 24]),
        ('south_street', 'street', [2, 16, 24, 22]),
        # South lane: a jog from the square to the south street and its loggia.
        ('south_lane_a', 'street', [2, 4, 7, 10]),
        ('south_lane_b', 'street', [6, 8, 9, 16]),
        # East street and the bakers' quarter.
        # Leaves the square at its north-east corner: no exit lines up across the square.
        ('east_street', 'street', [11, -5, 20, -1]),
        ('baker_court', 'court', [9, 8, 18, 13]),
        ('baker_arch', 'passage', [12, -1, 15, 8]),
        ('baker_s', 'street', [12, 13, 15, 16]),
        ('baker_e', 'street', [18, 8, 25, 13]),
        ('east_lane_s', 'street', [22, 13, 25, 18]),
    ]
    out = []
    for spec in specs:
        name, kind, r = spec[:3]
        opts = dict(spec[3]) if len(spec) > 3 else {}
        height = opts.pop('height', 0.0)
        out.append(A(name, kind, *r, height=height, extra=opts))
    return out


def town_underground():
    """Cistern passage: an old vaulted cistern and wine cellar beneath the square's west wing.
    It links the market court (portal in its north-east corner) with the cistern court at the
    square's south-west corner, a covered alternative to market_e and the open square."""
    return [{
        'id': 'cistern_passage', 'style': 'cellar',
        'purpose': 'Old cistern and wine cellar beneath the square, between the market and the cistern court',
        'segments': [[-11.2, -10.58, -8.8, -3.0], [-11.2, -3.0, -2.7, 2.0], [-5.1, 2.0, -2.7, 4.0]],
        'piers': [[-8.4, -0.5], [-5.6, -0.5]],
        'entrances': [
            {'id': 'market', 'type': 'dogleg', 'rect': [-13, -15.98, -9.02, -10.58], 'side': 's', 'hand': 'left'},
            {'id': 'cistern', 'type': 'dogleg', 'rect': [-4.98, 4, -1, 9.4], 'side': 'n', 'hand': 'left'},
        ],
        'route': [[-10.0, -6.0], [-10.0, 0.8], [-3.9, 0.8]],
    }]


def industrial(A):
    """Industrial Complex, 2026-11 overhaul: three building bands instead of a ring road. Walk-in
    stores and machinery halls flank a fenced utility yard; a central loading yard with a raised
    dock, a two-storey dispatch office and a rooftop workshop cluster fill the middle; outdoor
    storage, warehouse B and the container yard close the south. A catwalk crosses the south lane."""
    specs = [
        # North band: walk-in halls either side of the fenced utility yard.
        ('stores_hall', 'interior', [-24, -25, -11, -17]),
        # The halls' side alleys are offset, so their doorways never line up across the yard.
        ('stores_east', 'alley', [-11, -25, -8, -21]),
        ('utility_yard', 'yard', [-8, -25, 6, -17]),
        ('utility_east', 'alley', [6, -21, 9, -17]),
        ('machine_hall', 'interior', [9, -25, 24, -17]),
        ('service_lane_w', 'street', [-26, -17, -6, -14]),
        ('service_lane_e', 'street', [6, -17, 26, -14]),
        ('loading_gate', 'passage', [-1, -17, 3, -11]),
        # Middle band: west yard, dispatch office, loading yard and dock, rooftop workshops.
        ('west_alley', 'alley', [-26, -14, -23, -11]),
        ('west_yard', 'yard', [-27, -11, -19, 5]),
        ('dispatch_hall', 'interior', [-19, -8, -7, 2]),
        ('dispatch_north', 'alley', [-15, -14, -11, -8]),
        ('dispatch_south', 'alley', [-12, 2, -7, 9]),
        ('loading_yard', 'yard', [-7, -11, 10, 3]),
        ('loading_dock', 'dock', [10, -11, 13, 3], {'height': 1.1, 'stairs': [('w', (-11, -8))]}),
        ('dock_lane', 'street', [13, -14, 17, 6]),
        ('workshop_yard', 'yard', [17, -2, 27, 3]),
        # South band: the catwalk lane, storage yard, goods office, warehouse B and containers.
        ('south_lane', 'street', [-7, 3, 13, 9]),
        ('storage_yard', 'yard', [-26, 9, -12, 21]),
        ('goods_office', 'interior', [-12, 9, -9, 15], {'lot': [-12, 9, -9, 21]}),
        ('goods_alley', 'alley', [-9, 9, -6, 21]),
        ('warehouse_b', 'interior', [-6, 9, 9, 21]),
        ('container_link', 'alley', [9, 13, 13, 17]),
        ('container_north', 'alley', [21, 3, 24, 9]),
        ('container_yard', 'yard', [13, 9, 27, 21]),
        ('south_service', 'street', [-15, 21, 18, 25]),
    ]
    out = []
    for spec in specs:
        name, kind, r = spec[:3]
        opts = dict(spec[3]) if len(spec) > 3 else {}
        height = opts.pop('height', 0.0)
        out.append(A(name, kind, *r, height=height, extra=opts))
    return out


def city(A):
    """Modern City, 2026-11 overhaul: a broad avenue meets Main Street at a T beside a granite civic
    plaza. A metro underpass dives under the avenue between the civic and south plazas, a glazed
    skywalk crosses it between two courts, and service alleys, a west square behind an arcade and
    a parking lot complete the district. No road runs the full width of the map."""
    specs = [
        ('avenue','street',[-9,-3,27,4],'ns'),
        ('main_st','street',[-9,-27,-2,-3],'we'),
        ('civic_plaza','plaza',[-2,-15,10,-3]),
        ('south_plaza','plaza',[-2,4,8,12]),
        ('south_lane','street',[3,12,8,18]),
        ('south_street','street',[-12,18,8,22]),
        ('ne_alley','alley',[10,-11,18,-7]),
        ('ne_court','court',[18,-16,26,-3]),
        ('commerce_hall','interior',[8,4,16,13]),
        ('east_court','court',[16,4,26,17]),
        ('back_alley','alley',[8,13,16,17]),
        ('west_arcade','passage',[-12,-7,-9,-4]),
        ('west_square','court',[-24,-7,-12,5]),
        ('west_alley','alley',[-27,-17,-24,-3]),
        ('nw_court','court',[-21,-21,-13,-12]),
        ('nw_link','alley',[-13,-18,-9,-15]),
        ('nw_west','alley',[-24,-17,-21,-12]),
        ('parking_north','alley',[-18,5,-15,10]),
        ('parking','yard',[-24,10,-12,22]),
    ]
    return [A(s[0],s[1],*s[2],extra={'sidewalks':s[3]} if len(s)>3 else {}) for s in specs]


def city_underground():
    """Metro underpass: straight stairs from the civic plaza and the south plaza meet a tiled
    concourse beneath the avenue."""
    return [{
        'id': 'metro_underpass', 'style': 'metro',
        'purpose': 'Pedestrian metro underpass beneath the avenue between the civic and south plazas',
        'segments': [[2.6, -5.6, 6.0, -3.0], [0.6, -3.0, 8.0, 3.0], [2.6, 3.0, 6.0, 5.4]],
        'piers': [[2.2, 0.0], [6.4, 0.0]],
        'entrances': [
            {'id': 'civic', 'type': 'straight', 'rect': [3, -12.2, 5.6, -5.6], 'side': 'n'},
            {'id': 'south', 'type': 'straight', 'rect': [3, 5.4, 5.6, 12.0], 'side': 's'},
        ],
        'route': [[4.3, -2.0], [4.3, 2.0]],
    }]
