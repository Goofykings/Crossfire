"""Authored metre-scale routes for small public matches; no model scaling/mirroring.

These rectangles feed the existing lot, facade, interior and PBR exporters.
Covered rectangles deliberately replace street portions with real through-buildings.
"""


def town(A):
    return [A(name, kind, *r) for name, kind, r in [
        ('plaza', 'plaza', [-6,-6,6,6]),
        ('north_w','street',[-24,-24,-4,-20]), ('north_e','street',[-4,-22,24,-18]),
        ('north_jog','street',[-7,-22,0,-18]),
        ('south_w','street',[-24,18,1,22]), ('south_e','street',[1,20,24,24]),
        ('south_jog','street',[-2,18,4,24]),
        ('west_n','street',[-24,-24,-20,-8]), ('west_mid','street',[-22,-8,-18,8]),
        ('west_s','street',[-24,8,-20,22]),
        ('west_jog_n','street',[-24,-11,-18,-7]), ('west_jog_s','street',[-24,7,-18,11]),
        ('east_n','street',[20,-18,24,-5]), ('east_mid','street',[18,-5,22,10]),
        ('east_s','street',[20,10,24,24]),
        ('east_jog_n','street',[18,-8,24,-4]), ('east_jog_s','street',[18,8,24,12]),
        ('west_entry','street',[-20,-2,-6,3]), ('east_entry','street',[6,1,20,6]),
        ('north_entry','street',[0,-20,4,-6]), ('south_entry','street',[-4,6,0,20]),
        ('shop_lane','street',[-18,-22,-12,3]),
        ('shop_court','court',[-16,-16,-8,-8]), ('shop_north','street',[-12,-20,-8,-16]),
        ('shop_plaza','street',[-10,-8,-6,-2]), ('west_gate','passage',[-20,-12,-18,-9]),
        ('market_court','court',[9,-16,18,-8]), ('market_north','passage',[10,-18,14,-16]),
        ('market_east','street',[18,-12,20,-8]), ('market_plaza','street',[6,-8,10,1]),
        ('garden','court',[-17,10,-11,16]), ('garden_west','street',[-20,12,-17,16]),
        ('garden_south','street',[-15,16,-11,20]), ('garden_room','room',[-11,11,-4,14]),
        ('garden_north','street',[-16,3,-12,10]),
        ('baker_court','court',[8,10,16,17]), ('baker_north','street',[10,6,14,10]),
        ('baker_east','street',[16,12,20,16]), ('baker_south','street',[9,17,13,22]),
        ('baker_plaza','street',[0,12,8,16]),
        ('east_arcade','passage',[10,1,14,6]), ('west_arcade','passage',[-11,-2,-8,3]),
        ('north_arcade','passage',[4,-22,8,-18]), ('south_arcade','passage',[6,20,10,24]),
    ]]


def industrial(A):
    return [A(name, kind, *r) for name, kind, r in [
        ('loading_square','yard',[-6,-5,6,6]),
        ('west_service','street',[-25,-25,-21,9]), ('west_south','street',[-23,9,-19,23]),
        ('west_jog','street',[-25,5,-19,10]),
        ('north_service','street',[-25,-25,23,-21]),
        ('east_service','street',[21,-21,25,25]),
        ('south_service','street',[-23,21,25,25]),
        ('warehouse_n','interior',[-7,-20,5,-10]), ('hall_north','alley',[-4,-21,0,-20]),
        ('hall_south','alley',[-3,-10,1,-5]),
        ('west_cross','street',[-21,-9,-6,-4]),
        ('workshop','interior',[-18,-18,-11,-9]), ('workshop_north','alley',[-18,-21,-14,-18]),
        ('workshop_east','alley',[-11,-16,-7,-12]),
        ('utility_yard','yard',[9,-17,21,-7]), ('utility_west','alley',[5,-16,9,-12]),
        ('utility_north','alley',[14,-21,18,-17]), ('utility_south','alley',[13,-7,17,3]),
        ('east_cross','street',[6,2,21,7]),
        ('warehouse_s','interior',[-6,11,6,21]), ('hall_s_link','alley',[-2,6,2,11]),
        ('warehouse_east','alley',[6,14,12,18]), ('warehouse_west','alley',[-14,13,-6,17]),
        ('south_storage','yard',[12,11,21,21]), ('storage_north','alley',[14,7,18,11]),
        ('south_gallery_lane','street',[-19,-4,-13,15]),
        ('west_goods','yard',[-13,4,-6,10]), ('goods_link','alley',[-8,0,-6,6]),
        ('west_south_link','alley',[-19,17,-14,21]), ('west_south_court','yard',[-17,13,-11,21]),
        ('north_gate','passage',[-13,-25,-9,-21]),
        ('east_gate','passage',[21,-3,25,1]), ('south_gate','passage',[7,21,11,25]),
    ]]


def city(A):
    specs = [
        ('plaza','plaza',[-6,-6,6,6]),
        ('north_road','street',[-25,-25,2,-17],'ns'),
        ('north_east','street',[2,-23,25,-17],'n'),
        ('west_road','street',[-25,-17,-19,5],'w'),
        ('west_jog','street',[-25,5,-17,11],'s'),
        ('south_west','street',[-23,11,-17,24],'w'),
        ('south_road','street',[-17,18,25,25],'s'),
        ('east_road','street',[19,-17,25,18],'e'),
        ('west_plaza','street',[-19,-2,-6,4],'s'),
        ('east_plaza','street',[6,0,19,6],'n'),
        ('north_plaza','alley',[-2,-17,2,-6]),
        ('south_plaza','alley',[-3,6,1,18]),
        ('diner','interior',[-15,-16,-6,-10]),
        ('diner_north','alley',[-13,-17,-9,-16]),
        ('diner_west','alley',[-19,-13,-15,-9]),
        ('diner_south','alley',[-11,-10,-7,-2]),
        ('north_court','court',[7,-15,16,-7]),
        ('court_north','passage',[10,-17,14,-15]),
        ('court_east','alley',[16,-12,19,-8]),
        ('court_south','interior',[7,-7,12,0]),
        ('court_west','alley',[2,-12,7,-9]),
        ('service_lane','alley',[-15,4,-9,23]),
        ('garden_court','court',[-9,9,-3,16]),
        ('south_shop','interior',[6,9,14,18]),
        ('shop_north','alley',[8,6,12,9]), ('shop_east','alley',[14,12,19,16]),
        ('shop_west','passage',[1,11,6,14]),
        ('west_lobby','passage',[-18,-2,-15,4]),
        ('east_lobby','passage',[14,0,17,6]),
        ('south_lobby','passage',[2,18,6,25]),
    ]
    return [A(s[0],s[1],*s[2],extra={'sidewalks':s[3]} if len(s)>3 else {}) for s in specs]
