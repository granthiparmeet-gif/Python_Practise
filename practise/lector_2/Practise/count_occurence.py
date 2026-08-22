fruits = ['apple', 'banana', 'apple', 'orange', 'banana', 'apple']

fruit_count= dict()



for fruit in fruits:
    if fruit in fruit_count:
        fruit_count[fruit] += 1
    else:
        fruit_count[fruit] = 1

print(fruit_count)

