x=list(range(1,16))

print(x)

first_five = x[0:5:1]
print (first_five)

last_five = x[-5::1]
print (last_five)

third_element = x [::3]
print (third_element)

#new_list = [expression for item in iterable if condition]
square_of_even = [i*i for i in x if i % 2 == 0 ]
print(square_of_even)

