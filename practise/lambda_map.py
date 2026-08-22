# cube = lambda x: x*x*x
# y = cube(4)
# print(y)

list_a = [1,2,3,4,5,6,7,8,9,10]

new_list = list(map(lambda x : x*x, list_a))
print(new_list)