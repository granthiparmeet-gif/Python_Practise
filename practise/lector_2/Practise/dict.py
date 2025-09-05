
# x = {
#     "name" : "Parmeet",
#     "age"  : "32",
#     "city" : "Abd"
# }

info = dict()
print(info)
print(type(info))

info["name"] = "Parmeet"
print(info)

info["age"] = 32 # This will add the element

info["location"] = "Abd"

print (info)

info["age"] = 33 #This will Modify the element

print(info)

del info["age"]

print(info)

print(info.keys())
print(info.values())
print(info.items())

