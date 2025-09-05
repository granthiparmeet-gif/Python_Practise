tup = (1,2.0,"This is a string", 2%2==0)

print(tup)


integer, flt, string , boolean = tup #this is a tuple unpacking

try:
    tup[0] = 1
except TypeError as e:
    print("There is an error")
    print(e)

x = tup[0]
y = tup[1]
print(f"The first element is {x}")
print(f"The send element is {y}")

print (string)